import {
  type ConceptBundle,
  ConceptBundleItem,
  CurrentUser,
  defaultPageLimit,
  type FeedCursor,
  InvalidLesson,
  InvalidSettings,
  type Issue,
  type Lesson,
  LessonId,
  LessonNotFound,
  type LessonPage,
  type LessonUpdate,
  type LessonVersion,
  LessonVersionId,
  maxTags,
  PayloadTooLarge,
  type Published,
  platformPrefix,
  platformUserId,
  VersionNotFound,
} from "@app/api"
import { Database, lesson, lessonLang, raw, sqlBuilder, uuidv7 } from "@app/db"
import {
  compareTranslations,
  decodeConcept,
  decodeLesson,
  isConceptCardRef,
  type LessonLang,
  lessonSchemaVersion,
  maxLessonBytes,
  parseConceptRef,
  validateLesson,
} from "@app/domain"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Result, Schema } from "effect"
import { canonicalJson, contentKey, sha256Hex } from "./content.ts"
import {
  after,
  HashRow,
  inList,
  LessonRow,
  langsAndTags,
  lessonColumns,
  lessonFrom,
  readableBy,
  toLessonPage,
  VersionRow,
} from "./rows.ts"
import { Storage } from "./storage.ts"
import { normalizeTag } from "./tags.ts"

// Reads of one lesson. `R` is what reading needs: `never` for anonymous readers, who see public
// and unlisted lessons only, and `CurrentUser` for signed-in readers, who also see their own
// private lessons. So a private lesson can only be read by code that has a CurrentUser in its
// Effect type.
export interface LessonReads<R> {
  readonly get: (id: LessonId) => Effect.Effect<Lesson, LessonNotFound, R>
  readonly getBySlug: (handle: string, slug: string) => Effect.Effect<Lesson, LessonNotFound, R>
  readonly versions: (
    id: LessonId,
    lang: LessonLang | undefined,
  ) => Effect.Effect<ReadonlyArray<LessonVersion>, LessonNotFound, R>
  // The stored JSON bytes of one version.
  readonly body: (
    id: LessonId,
    versionId: LessonVersionId,
  ) => Effect.Effect<Uint8Array, LessonNotFound | VersionNotFound, R>
  // `shared`: the lesson is public or unlisted, so the bundle may be cached publicly (a version's
  // pins never change).
  readonly concepts: (
    id: LessonId,
    versionId: LessonVersionId,
  ) => Effect.Effect<
    { readonly bundle: ConceptBundle; readonly shared: boolean },
    LessonNotFound | VersionNotFound,
    R
  >
}

export class Lessons extends Context.Service<
  Lessons,
  {
    readonly anonymous: LessonReads<never>
    readonly asUser: LessonReads<CurrentUser>
    // Owner-only changes. Anyone else gets the same 404 as for a missing lesson.
    readonly update: (
      id: LessonId,
      patch: LessonUpdate,
    ) => Effect.Effect<Lesson, LessonNotFound | InvalidSettings, CurrentUser>
    readonly remove: (id: LessonId) => Effect.Effect<void, LessonNotFound, CurrentUser>
    readonly mine: (options: {
      readonly cursor?: FeedCursor | undefined
      readonly limit?: number | undefined
    }) => Effect.Effect<LessonPage, never, CurrentUser>
    // pi's /publish: validate, store the body by hash, add the next version of its language.
    readonly publish: (
      slug: string,
      body: Uint8Array,
    ) => Effect.Effect<Published, InvalidLesson | PayloadTooLarge, CurrentUser>
  }
>()("@app/services/Lessons") {
  // Database, storage and decoding failures are unexpected here; they become defects (HTTP 500).
  static readonly layer = Layer.effect(
    Lessons,
    Effect.gen(function* () {
      const db = yield* Database
      const storage = yield* Storage

      const loadRow = (where: ReturnType<typeof sql>) =>
        db.query(raw(sql`select ${lessonColumns} from ${lessonFrom} where ${where} limit 1`), LessonRow).pipe(
          Effect.orDie,
          Effect.map((rows) => Option.fromNullishOr(rows[0])),
        )

      const toLesson = Effect.fn("Lessons.toLesson")(function* (row: LessonRow, viewer: string | undefined) {
        const extra = yield* langsAndTags(db, [row.id]).pipe(Effect.orDie)
        const result: Lesson = {
          id: row.id,
          owner_handle: row.owner_handle,
          slug: row.slug,
          kind: row.kind,
          default_lang: row.default_lang,
          title: row.title,
          summary: row.summary,
          category_id: row.category_id,
          visibility: row.visibility,
          tags: extra.tags.map((tag) => tag.slug),
          langs: extra.langs.map((lang) => ({
            lang: lang.lang,
            version_id: lang.version_id,
            n: lang.n,
            body_hash: lang.body_hash,
            title: lang.title,
            summary: lang.summary,
            updated_at: lang.updated_at,
          })),
          like_count: row.like_count,
          published_at: row.published_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
          is_owner: viewer === row.owner_id,
        }
        return result
      })

      const readable = Effect.fn("Lessons.readable")(function* (id: LessonId, viewer: string | undefined) {
        const row = yield* loadRow(sql`l.id = ${id} and ${readableBy(viewer)}`)
        if (Option.isNone(row)) return yield* new LessonNotFound()
        return row.value
      })

      const version = Effect.fn("Lessons.version")(function* (id: LessonId, versionId: LessonVersionId) {
        const rows = yield* db
          .query(
            raw(sql`select id, lesson_id, lang, n, body_hash, body_bytes, schema, note, created_at
              from lesson_version where id = ${versionId} and lesson_id = ${id}`),
            VersionRow,
          )
          .pipe(Effect.orDie)
        if (rows[0] === undefined) return yield* new VersionNotFound()
        return rows[0]
      })

      const readBody = Effect.fn("Lessons.readBody")(function* (hash: string) {
        const stored = yield* storage.get(contentKey(hash)).pipe(Effect.orDie)
        if (Option.isNone(stored)) return yield* Effect.die(new Error(`body ${hash} is missing from storage`))
        return stored.value.body
      })

      // One implementation of the reads; `viewer` says whose private lessons are visible.
      const reads = <R>(viewer: Effect.Effect<string | undefined, never, R>): LessonReads<R> => ({
        get: Effect.fn("Lessons.get")(function* (id: LessonId) {
          const who = yield* viewer
          return yield* toLesson(yield* readable(id, who), who)
        }),
        getBySlug: Effect.fn("Lessons.getBySlug")(function* (handle: string, slug: string) {
          const who = yield* viewer
          const row = yield* loadRow(sql`p.handle = ${handle} and l.slug = ${slug} and ${readableBy(who)}`)
          if (Option.isNone(row)) return yield* new LessonNotFound()
          return yield* toLesson(row.value, who)
        }),
        versions: Effect.fn("Lessons.versions")(function* (id: LessonId, lang: LessonLang | undefined) {
          yield* readable(id, yield* viewer)
          return yield* db
            .query(
              raw(sql`select id, lesson_id, lang, n, body_hash, body_bytes, schema, note, created_at
                from lesson_version where lesson_id = ${id} ${lang === undefined ? sql`` : sql`and lang = ${lang}`}
                order by lang, n desc`),
              VersionRow,
            )
            .pipe(Effect.orDie)
        }),
        body: Effect.fn("Lessons.body")(function* (id: LessonId, versionId: LessonVersionId) {
          yield* readable(id, yield* viewer)
          const found = yield* version(id, versionId)
          return yield* readBody(found.body_hash)
        }),
        concepts: Effect.fn("Lessons.concepts")(function* (id: LessonId, versionId: LessonVersionId) {
          const row = yield* readable(id, yield* viewer)
          yield* version(id, versionId)
          const pinned = yield* db
            .query(
              raw(sql`select lvc.card_id, c.slug, cv.lang, cv.n, cv.id as version_id, cv.body_hash
                from lesson_version_concept lvc
                join concept_version cv on cv.id = lvc.concept_version_id
                join concept c on c.id = cv.concept_id
                where lvc.lesson_version_id = ${versionId} order by lvc.card_id`),
              PinnedRow,
            )
            .pipe(Effect.orDie)
          const items = yield* Effect.forEach(
            pinned,
            (pin) =>
              readBody(pin.body_hash).pipe(
                Effect.flatMap((bytes) => decodeStored(bytes, decodeConcept)),
                Effect.map((spec) => ConceptBundleItem.make({ ...pin, spec })),
              ),
            { concurrency: 8 },
          )
          return { bundle: { items }, shared: row.visibility !== "private" }
        }),
      })

      const anonymous = reads(Effect.succeed(undefined))
      const asUser = reads(
        Effect.service(CurrentUser).pipe(Effect.map((user): string | undefined => user.id)),
      )

      const owned = Effect.fn("Lessons.owned")(function* (id: LessonId) {
        const user = yield* CurrentUser
        const row = yield* loadRow(sql`l.id = ${id} and l.owner_id = ${user.id} and l.deleted_at is null`)
        if (Option.isNone(row)) return yield* new LessonNotFound()
        return row.value
      })

      const update = Effect.fn("Lessons.update")(function* (id: LessonId, patch: LessonUpdate) {
        const user = yield* CurrentUser
        const row = yield* owned(id)
        const now = Date.now()

        const categoryId = patch.category_id === undefined ? row.category_id : patch.category_id
        if (patch.category_id !== undefined && patch.category_id !== null) {
          // The `platform` category tree holds the platform's own guides.
          const reserved =
            patch.category_id === platformPrefix || patch.category_id.startsWith(`${platformPrefix}.`)
          if (reserved && user.id !== platformUserId)
            return yield* new InvalidSettings({ message: `category ${patch.category_id} is reserved` })
          const found = yield* db
            .query(raw(sql`select id from category where id = ${patch.category_id}`), IdRow)
            .pipe(Effect.orDie)
          if (found.length === 0)
            return yield* new InvalidSettings({ message: `unknown category ${patch.category_id}` })
        }

        const tags = patch.tags === undefined ? undefined : yield* normalizeTags(patch.tags)
        const oldTags = yield* db
          .query(raw(sql`select tag_id as id from lesson_tag where lesson_id = ${id}`), IdRow)
          .pipe(Effect.orDie)
        const tagCount = tags === undefined ? oldTags.length : tags.length

        const visibility = patch.visibility ?? row.visibility
        if (visibility === "public") {
          const langs = yield* db
            .query(raw(sql`select lesson_id as id from lesson_lang where lesson_id = ${id} limit 1`), IdRow)
            .pipe(Effect.orDie)
          const missing = [
            categoryId === null ? "a category" : undefined,
            tagCount === 0 ? "at least one tag" : undefined,
            langs.length === 0 ? "a published version" : undefined,
          ].filter((reason) => reason !== undefined)
          if (missing.length > 0) {
            return yield* new InvalidSettings({ message: `a public lesson needs ${missing.join(", ")}` })
          }
        }
        const isPublic = visibility === "public" ? 1 : 0
        const publishedAt = visibility === "public" ? (row.published_at ?? now) : row.published_at

        const tagStatements =
          tags === undefined
            ? [
                raw(sql`update lesson_tag set is_public = ${isPublic}, published_at = ${publishedAt},
                  hot_score = ${row.hot_score} where lesson_id = ${id}`),
              ]
            : [
                ...tags.map((tag) =>
                  raw(sql`insert into tag (id, slug, name, lesson_count) values (${uuidv7()}, ${tag.slug}, ${tag.name}, 0)
                    on conflict (slug) do nothing`),
                ),
                raw(sql`delete from lesson_tag where lesson_id = ${id}`),
                ...(tags.length === 0
                  ? []
                  : [
                      raw(sql`insert into lesson_tag (lesson_id, tag_id, is_public, published_at, hot_score)
                        select ${id}, id, ${isPublic}, ${publishedAt}, ${row.hot_score} from tag
                        where slug in ${inList(tags.map((tag) => tag.slug))}`),
                    ]),
              ]
        const touchedTags = sql.join(
          [
            ...(oldTags.length === 0 ? [] : [sql`id in ${inList(oldTags.map((tag) => tag.id))}`]),
            ...(tags === undefined || tags.length === 0
              ? []
              : [sql`slug in ${inList(tags.map((tag) => tag.slug))}`]),
          ],
          sql` or `,
        )
        const hasTouched = oldTags.length > 0 || (tags !== undefined && tags.length > 0)

        yield* db
          .batch([
            sqlBuilder
              .update(lesson)
              .set({ visibility, category_id: categoryId, published_at: publishedAt, updated_at: now })
              .where(sql`${lesson.id} = ${id}`),
            ...tagStatements,
            // Counters are recounted from the index, in the same batch, so they cannot drift.
            ...(hasTouched
              ? [
                  raw(sql`update tag set lesson_count = (select count(*) from lesson_tag lt
                    where lt.tag_id = tag.id and lt.is_public = 1) where ${touchedTags}`),
                ]
              : []),
            recountProfile(user.id),
          ])
          .pipe(Effect.orDie)
        return yield* asUser.get(id).pipe(Effect.orDie)
      })

      const remove = Effect.fn("Lessons.remove")(function* (id: LessonId) {
        const user = yield* CurrentUser
        const row = yield* owned(id)
        const now = Date.now()
        // Soft delete. The slug gets the id appended, so the owner can reuse the slug. Bodies stay
        // in R2 (another lesson may share a hash); `/c/` stops serving them for this lesson.
        yield* db
          .batch([
            raw(sql`update lesson set deleted_at = ${now}, updated_at = ${now}, visibility = 'private',
              slug = ${`${row.slug}~${row.id}`} where id = ${id}`),
            raw(sql`update lesson_tag set is_public = 0 where lesson_id = ${id}`),
            raw(sql`update tag set lesson_count = (select count(*) from lesson_tag lt
              where lt.tag_id = tag.id and lt.is_public = 1)
              where id in (select tag_id from lesson_tag where lesson_id = ${id})`),
            recountProfile(user.id),
          ])
          .pipe(Effect.orDie)
      })

      const mine = Effect.fn("Lessons.mine")(function* (options: {
        readonly cursor?: FeedCursor | undefined
        readonly limit?: number | undefined
      }) {
        const user = yield* CurrentUser
        const limit = options.limit ?? defaultPageLimit
        const rows = yield* db
          .query(
            raw(sql`select ${lessonColumns} from ${lessonFrom}
              where l.owner_id = ${user.id} and l.deleted_at is null
                and ${after(sql`l.updated_at`, sql`l.id`, options.cursor)}
              order by l.updated_at desc, l.id desc limit ${limit + 1}`),
            LessonRow,
          )
          .pipe(Effect.orDie)
        return yield* toLessonPage(db, rows, limit, (row) => row.updated_at).pipe(Effect.orDie)
      })

      const publish = Effect.fn("Lessons.publish")(function* (slug: string, body: Uint8Array) {
        const user = yield* CurrentUser
        if (body.byteLength > maxLessonBytes) return yield* new PayloadTooLarge({ max_bytes: maxLessonBytes })
        const json = yield* parseJson(body).pipe(Effect.mapError((issues) => new InvalidLesson({ issues })))
        const decoded = decodeLesson(json)
        if (Result.isFailure(decoded)) {
          return yield* new InvalidLesson({
            issues: [{ path: "$", code: "schema", message: decoded.failure.message }],
          })
        }
        const spec = decoded.success

        const refs = Object.entries(spec.cards).flatMap(([cardId, entry]) =>
          isConceptCardRef(entry) ? [{ cardId, ...parseConceptRef(entry.concept) }] : [],
        )
        const concepts = yield* resolveConcepts(
          refs.map((ref) => ref.slug),
          spec.lang,
        )
        const pinOf = (slug: string, n: number | undefined) =>
          concepts.find((row) => row.slug === slug && (n === undefined ? row.is_current === 1 : row.n === n))
        const issues: Array<Issue> = [
          ...validateLesson(spec, { resolveConcept: (slug, n) => pinOf(slug, n) !== undefined }),
        ]

        const existing = yield* loadRow(
          sql`l.owner_id = ${user.id} and l.slug = ${slug} and l.deleted_at is null`,
        )
        if (Option.isSome(existing) && existing.value.kind !== spec.kind) {
          issues.push({
            path: "kind",
            code: "parity",
            message: `lesson "${slug}" is a ${existing.value.kind} lesson; this body is ${spec.kind}`,
          })
        }
        // Every language of a lesson has the same structure (ids, links, widgets); check this body
        // against the current version of each other language.
        if (Option.isSome(existing)) {
          const others = yield* db
            .query(
              raw(sql`select v.body_hash from lesson_lang ll join lesson_version v on v.id = ll.version_id
                where ll.lesson_id = ${existing.value.id} and ll.lang <> ${spec.lang}`),
              HashRow,
            )
            .pipe(Effect.orDie)
          for (const other of others) {
            const otherSpec = yield* readBody(other.body_hash).pipe(
              Effect.flatMap((bytes) => decodeStored(bytes, decodeLesson)),
            )
            issues.push(...compareTranslations(otherSpec, spec))
          }
        }
        if (issues.length > 0) return yield* new InvalidLesson({ issues })

        const canonical = canonicalJson(spec)
        const hash = yield* Effect.promise(() => sha256Hex(canonical))
        const key = contentKey(hash)
        if (!(yield* storage.exists(key).pipe(Effect.orDie))) {
          yield* storage.put(key, { body: canonical, contentType: "application/json" }).pipe(Effect.orDie)
        }

        const now = Date.now()
        const lessonId = Option.match(existing, {
          onNone: () => LessonId.make(uuidv7(now)),
          onSome: (row) => row.id,
        })
        const versionId = uuidv7(now)
        yield* db
          .batch([
            ...(Option.isNone(existing)
              ? [
                  sqlBuilder.insert(lesson).values({
                    id: lessonId,
                    owner_id: user.id,
                    slug,
                    kind: spec.kind,
                    default_lang: spec.lang,
                    title: spec.title,
                    summary: spec.summary,
                    visibility: "private",
                    created_at: now,
                    updated_at: now,
                  }),
                ]
              : []),
            // Next number of this language; the unique (lesson_id, lang, n) refuses a racing twin.
            raw(sql`insert into lesson_version (id, lesson_id, lang, n, body_hash, body_bytes, schema, note, created_at)
              select ${versionId}, ${lessonId}, ${spec.lang}, coalesce(max(n), 0) + 1, ${hash}, ${canonical.byteLength},
                ${lessonSchemaVersion}, null, ${now}
              from lesson_version where lesson_id = ${lessonId} and lang = ${spec.lang}`),
            sqlBuilder
              .insert(lessonLang)
              .values({
                lesson_id: lessonId,
                lang: spec.lang,
                version_id: versionId,
                title: spec.title,
                summary: spec.summary,
                updated_at: now,
              })
              .onConflictDoUpdate({
                target: [lessonLang.lesson_id, lessonLang.lang],
                set: { version_id: versionId, title: spec.title, summary: spec.summary, updated_at: now },
              }),
            raw(sql`update lesson set updated_at = ${now},
              title = case when default_lang = ${spec.lang} then ${spec.title} else title end,
              summary = case when default_lang = ${spec.lang} then ${spec.summary} else summary end
              where id = ${lessonId}`),
            // Pin the concept version each `{ concept }` card resolved to now.
            ...refs.flatMap((ref) => {
              const pin = pinOf(ref.slug, ref.version)
              return pin === undefined
                ? []
                : [
                    raw(sql`insert into lesson_version_concept (lesson_version_id, card_id, concept_version_id)
                      values (${versionId}, ${ref.cardId}, ${pin.version_id})`),
                  ]
            }),
          ])
          .pipe(Effect.orDie)

        const published = yield* asUser.get(lessonId).pipe(Effect.orDie)
        const stored = yield* version(lessonId, LessonVersionId.make(versionId)).pipe(Effect.orDie)
        return { lesson: published, version: stored }
      })

      // Every version of the given concepts in one language, with which one is current.
      const resolveConcepts = Effect.fn("Lessons.resolveConcepts")(function* (
        slugs: ReadonlyArray<string>,
        lang: LessonLang,
      ) {
        if (slugs.length === 0) return []
        return yield* db
          .query(
            raw(sql`select c.slug, cv.n, cv.id as version_id,
                case when cl.version_id = cv.id then 1 else 0 end as is_current
              from concept c
              join concept_version cv on cv.concept_id = c.id and cv.lang = ${lang}
              left join concept_lang cl on cl.concept_id = c.id and cl.lang = ${lang}
              where c.slug in ${inList([...new Set(slugs)])}`),
            ConceptPinRow,
          )
          .pipe(Effect.orDie)
      })

      return Lessons.of({ anonymous, asUser, update, remove, mine, publish })
    }),
  )
}

const IdRow = Schema.Struct({ id: Schema.String })
const ConceptPinRow = Schema.Struct({
  slug: Schema.String,
  n: Schema.Int,
  version_id: Schema.String,
  is_current: Schema.Int,
})
const PinnedRow = ConceptBundleItem.mapFields(({ spec: _spec, ...fields }) => fields)

const recountProfile = (userId: string) =>
  raw(sql`update profile set lesson_count = (select count(*) from lesson
    where owner_id = ${userId} and visibility = 'public' and deleted_at is null) where user_id = ${userId}`)

const normalizeTags = Effect.fn("Lessons.normalizeTags")(function* (inputs: ReadonlyArray<string>) {
  const tags = inputs.map((input) => ({ name: input.trim(), slug: normalizeTag(input) }))
  const empty = tags.find((tag) => tag.slug === "")
  if (empty !== undefined)
    return yield* new InvalidSettings({ message: `tag "${empty.name}" has no letters or digits` })
  const unique = tags.filter((tag, index) => tags.findIndex((other) => other.slug === tag.slug) === index)
  if (unique.length > maxTags) return yield* new InvalidSettings({ message: `at most ${maxTags} tags` })
  return unique
})

const parseJson = (body: Uint8Array) =>
  Effect.try({
    try: (): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body)),
    catch: (cause) => [{ path: "$", code: "json", message: `not JSON: ${String(cause)}` }],
  })

// A stored body was validated before it was written, so failing to decode it is a defect.
const decodeStored = <A>(
  bytes: Uint8Array,
  decode: (input: unknown) => Result.Result<A, Schema.SchemaError>,
) =>
  Effect.try({
    try: (): unknown => JSON.parse(new TextDecoder().decode(bytes)),
    catch: (cause) => cause,
  }).pipe(
    Effect.flatMap((json) => Effect.fromResult(decode(json))),
    Effect.orDie,
  )
