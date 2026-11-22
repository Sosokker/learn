import {
  type ConceptBundle,
  ConceptBundleItem,
  ConceptVersionId,
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
  LessonValidate,
  type LessonValidation,
  type LessonVersion,
  LessonVersionId,
  maxTags,
  PayloadTooLarge,
  type Published,
  type PublishedLesson,
  type PublishLessonUnchanged,
  type PublishUnchanged,
  platformPrefix,
  platformUserId,
  type UserId,
  VersionNotFound,
} from "@app/api"
import { Database, lesson, raw, sqlBuilder, uuidv7 } from "@app/db"
import {
  compareTranslations,
  decodeConcept,
  decodeLesson,
  isConceptCardRef,
  LessonLang,
  type LessonSpec,
  lessonSchemaVersion,
  maxLessonBytes,
  parseConceptRef,
  validateLesson,
} from "@app/domain"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Result, Schema } from "effect"
import { categoryAncestors } from "./categories.ts"
import { canonicalJson, contentKey, sha256Hex } from "./content.ts"
import { forgetLesson, viewerStateOf } from "./engagement.ts"
import { lessonSearchText, nextLessonFtsRowid, syncLessonLangs } from "./lesson-search.ts"
import {
  after,
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

// A spec and its position in the request, so an issue can point at `specs[i]`. Publish, validate
// and the single-language adapter all hand the same shape to the authoring checks.
interface IndexedSpec {
  readonly index: number
  readonly spec: LessonSpec
}

interface PlannedIssue {
  readonly index: number | null
  readonly issue: Issue
}

interface PlannedSpec extends IndexedSpec {
  readonly pins: ReadonlyArray<{ readonly card_id: string; readonly concept_version_id: ConceptVersionId }>
}

// English is the default language, so it is published first. The old per-language endpoint kept
// this order in the CLI; the server now owns it.
const langRank = (lang: LessonLang): number => (lang === "en" ? 0 : 1)

const samePinSet = (
  a: ReadonlyArray<{ readonly card_id: string; readonly concept_version_id: ConceptVersionId }>,
  b: ReadonlyArray<{ readonly card_id: string; readonly concept_version_id: ConceptVersionId }>,
): boolean =>
  a.length === b.length &&
  a.every((pin) =>
    b.some((other) => other.card_id === pin.card_id && other.concept_version_id === pin.concept_version_id),
  )

const bundlePath = (index: number) => `specs[${index}].`

const issueWithPath = (planned: PlannedIssue, pathPrefix: (index: number) => string): Issue =>
  planned.index === null
    ? planned.issue
    : { ...planned.issue, path: `${pathPrefix(planned.index)}${planned.issue.path}` }

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
    // pi's /publish: validate, store the body by hash, add the next version of its language. A
    // body identical to the language's current version (same hash, same concept pins) writes
    // nothing and returns that version (`created: false`).
    readonly publish: (
      slug: string,
      body: Uint8Array,
    ) => Effect.Effect<Published | PublishUnchanged, InvalidLesson | PayloadTooLarge, CurrentUser>
    // The lesson-level publish: one or two languages, checked together and written in one batch.
    // A partly published lesson cannot be produced by a bundle; the old single-language endpoint
    // remains as an adapter for clients that have not moved yet.
    readonly publishBundle: (
      slug: string,
      body: Uint8Array,
    ) => Effect.Effect<PublishedLesson | PublishLessonUnchanged, InvalidLesson | PayloadTooLarge, CurrentUser>
    // Read-only: the same checks as publish (schema, concepts, links, kind, en/th parity), nothing
    // written. The body is `{ "specs": [LessonSpec, ...] }` with the en and th bodies of one
    // lesson (1–2).
    readonly validate: (
      slug: string,
      body: Uint8Array,
    ) => Effect.Effect<LessonValidation, PayloadTooLarge, CurrentUser>
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

      const toLesson = Effect.fn("Lessons.toLesson")(function* (row: LessonRow, viewer: UserId | undefined) {
        const { extra, state } = yield* Effect.all(
          {
            extra: langsAndTags(db, [row.id]).pipe(Effect.orDie),
            state: viewer === undefined ? Effect.succeed(null) : viewerStateOf(db, row.id, viewer),
          },
          { concurrency: "unbounded" },
        )
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
          comment_count: row.comment_count,
          published_at: row.published_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
          is_owner: viewer === row.owner_id,
          viewer: state,
        }
        return result
      })

      const readable = Effect.fn("Lessons.readable")(function* (id: LessonId, viewer: UserId | undefined) {
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
      const reads = <R>(viewer: Effect.Effect<UserId | undefined, never, R>): LessonReads<R> => ({
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
        Effect.service(CurrentUser).pipe(Effect.map((user): UserId | undefined => user.id)),
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
        // Only public lessons are listed by category, under the category and each ancestor.
        const categoryStatements = [
          raw(sql`delete from lesson_category where lesson_id = ${id}`),
          ...(visibility === "public" && categoryId !== null && publishedAt !== null
            ? [
                raw(sql`insert into lesson_category (lesson_id, category_id, published_at)
                  select ${id}, id, ${publishedAt} from category
                  where id in ${inList(categoryAncestors(categoryId))}`),
              ]
            : []),
        ]

        yield* db
          .batch([
            ...countedAs(id, user.id, -1),
            sqlBuilder
              .update(lesson)
              .set({ visibility, category_id: categoryId, published_at: publishedAt, updated_at: now })
              .where(sql`${lesson.id} = ${id}`),
            ...tagStatements,
            ...categoryStatements,
            ...countedAs(id, user.id, 1),
            ...syncLessonLangs(id),
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
        // Everyone's likes, bookmarks and progress of it go too, and like_count with them.
        yield* db
          .batch([
            ...countedAs(id, user.id, -1),
            raw(sql`update lesson set deleted_at = ${now}, updated_at = ${now}, visibility = 'private',
              slug = ${`${row.slug}~${row.id}`}, like_count = 0 where id = ${id}`),
            ...forgetLesson(id),
            raw(sql`update lesson_tag set is_public = 0 where lesson_id = ${id}`),
            raw(sql`delete from lesson_category where lesson_id = ${id}`),
            // Out of the language feeds and search.
            ...syncLessonLangs(id),
            // No `countedAs(+1)`: a deleted lesson counts nowhere.
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

      // ── Authoring

      // Parse `{ "specs": [LessonSpec, ...] }`: the shape both the dry run and the lesson-level
      // publish accept. Schema failures stay issues (the caller can repair them), not defects.
      const parseBundle = Effect.fn("Lessons.parseBundle")(function* (body: Uint8Array) {
        if (body.byteLength > maxLessonBytes) return yield* new PayloadTooLarge({ max_bytes: maxLessonBytes })
        const parsed = yield* Effect.result(parseJson(body))
        if (Result.isFailure(parsed)) {
          const issue = parsed.failure[0]
          return {
            specs: [] as ReadonlyArray<IndexedSpec>,
            issues: [
              { index: null, issue: issue ?? { path: "$", code: "json", message: "not JSON" } },
            ] as ReadonlyArray<PlannedIssue>,
          }
        }
        const payload = Schema.decodeUnknownResult(LessonValidate, { onExcessProperty: "error" })(
          parsed.success,
        )
        if (Result.isFailure(payload)) {
          return {
            specs: [] as ReadonlyArray<IndexedSpec>,
            issues: [
              { index: null, issue: { path: "$", code: "schema", message: payload.failure.message } },
            ] as ReadonlyArray<PlannedIssue>,
          }
        }
        const rawSpecs = payload.success.specs
        if (rawSpecs.length < 1 || rawSpecs.length > 2) {
          return {
            specs: [] as ReadonlyArray<IndexedSpec>,
            issues: [
              {
                index: null,
                issue: { path: "specs", code: "count", message: "send one or two LessonSpecs" },
              },
            ] as ReadonlyArray<PlannedIssue>,
          }
        }
        const specs: Array<IndexedSpec> = []
        const issues: Array<PlannedIssue> = []
        for (const [index, json] of rawSpecs.entries()) {
          const decoded = decodeLesson(json)
          if (Result.isFailure(decoded)) {
            issues.push({ index, issue: { path: "$", code: "schema", message: decoded.failure.message } })
          } else {
            specs.push({ index, spec: decoded.success })
          }
        }
        return { specs, issues }
      })

      // The old per-language endpoint still sends one LessonSpec as the whole body.
      const parseSingle = Effect.fn("Lessons.parseSingle")(function* (body: Uint8Array) {
        if (body.byteLength > maxLessonBytes) return yield* new PayloadTooLarge({ max_bytes: maxLessonBytes })
        const parsed = yield* Effect.result(parseJson(body))
        if (Result.isFailure(parsed)) {
          const issue = parsed.failure[0]
          return {
            spec: undefined,
            issues: [issue ?? { path: "$", code: "json", message: "not JSON" }] as ReadonlyArray<Issue>,
          }
        }
        const decoded = decodeLesson(parsed.success)
        if (Result.isFailure(decoded)) {
          return {
            spec: undefined,
            issues: [{ path: "$", code: "schema", message: decoded.failure.message }] as ReadonlyArray<Issue>,
          }
        }
        return {
          spec: { index: 0, spec: decoded.success } satisfies IndexedSpec,
          issues: [] as ReadonlyArray<Issue>,
        }
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

      // The read-only half of publish: every rule that depends on the lesson, not one language.
      // `specs` is the whole set the caller sent; stored languages fill in the rest.
      const checkBundle = Effect.fn("Lessons.checkBundle")(function* (
        userId: UserId,
        slug: string,
        specs: ReadonlyArray<IndexedSpec>,
      ) {
        const issues: Array<PlannedIssue> = []
        if (specs.length === 0) {
          issues.push({
            index: null,
            issue: { path: "specs", code: "count", message: "send one or two LessonSpecs" },
          })
          return { existing: Option.none<LessonRow>(), plans: [], issues }
        }
        const langs = specs.map((entry) => entry.spec.lang)
        const duplicate = langs.find((lang, index) => langs.indexOf(lang) !== index)
        if (duplicate !== undefined) {
          issues.push({
            index: null,
            issue: { path: "specs", code: "duplicate", message: `two specs are ${duplicate}` },
          })
        }

        const existing = yield* loadRow(
          sql`l.owner_id = ${userId} and l.slug = ${slug} and l.deleted_at is null`,
        )
        if (Option.isSome(existing)) {
          for (const entry of specs) {
            if (existing.value.kind !== entry.spec.kind) {
              issues.push({
                index: entry.index,
                issue: {
                  path: "kind",
                  code: "parity",
                  message: `lesson "${slug}" is a ${existing.value.kind} lesson; this body is ${entry.spec.kind}`,
                },
              })
            }
          }
        }

        // Concepts resolve per language: an unpinned `{ concept }` card pins the current version
        // in this lesson's language, an explicit `slug@n` pins that one.
        const slugsByLang = new Map<LessonLang, Array<string>>()
        for (const { spec } of specs) {
          const slugs = slugsByLang.get(spec.lang) ?? []
          for (const entry of Object.values(spec.cards)) {
            if (isConceptCardRef(entry)) slugs.push(parseConceptRef(entry.concept).slug)
          }
          slugsByLang.set(spec.lang, slugs)
        }
        const conceptsByLang = new Map<LessonLang, ReadonlyArray<typeof ConceptPinRow.Type>>()
        for (const [lang, slugs] of slugsByLang) {
          conceptsByLang.set(lang, yield* resolveConcepts(slugs, lang))
        }

        const planByIndex = new Map<number, PlannedSpec>()
        for (const entry of specs) {
          const concepts = conceptsByLang.get(entry.spec.lang) ?? []
          const pinOf = (conceptSlug: string, n: number | undefined) =>
            concepts.find(
              (row) => row.slug === conceptSlug && (n === undefined ? row.is_current === 1 : row.n === n),
            )
          issues.push(
            ...validateLesson(entry.spec, {
              resolveConcept: (conceptSlug, n) => pinOf(conceptSlug, n) !== undefined,
            }).map((issue) => ({ index: entry.index, issue })),
          )
          const pins = Object.entries(entry.spec.cards).flatMap(([cardId, card]) => {
            if (!isConceptCardRef(card)) return []
            const ref = parseConceptRef(card.concept)
            const pin = pinOf(ref.slug, ref.version)
            return pin === undefined ? [] : [{ card_id: cardId, concept_version_id: pin.version_id }]
          })
          planByIndex.set(entry.index, { ...entry, pins })
        }

        // English first. Parity compares the new set against every stored language that is not
        // being replaced, and against the other specs in the same bundle.
        const ordered = [...specs].sort((a, b) => langRank(a.spec.lang) - langRank(b.spec.lang))
        const plans = ordered.flatMap((entry) => {
          const plan = planByIndex.get(entry.index)
          return plan === undefined ? [] : [plan]
        })
        const bundleLangs = new Set(langs)
        if (Option.isSome(existing)) {
          const stored = yield* db
            .query(
              raw(sql`select ll.lang, v.body_hash from lesson_lang ll
                join lesson_version v on v.id = ll.version_id
                where ll.lesson_id = ${existing.value.id}`),
              StoredLangRow,
            )
            .pipe(Effect.orDie)
          for (const row of stored) {
            if (bundleLangs.has(row.lang)) continue
            const storedSpec = yield* readBody(row.body_hash).pipe(
              Effect.flatMap((bytes) => decodeStored(bytes, decodeLesson)),
            )
            for (const plan of plans) {
              issues.push(
                ...compareTranslations(storedSpec, plan.spec).map((issue) => ({ index: plan.index, issue })),
              )
            }
          }
        }
        const [base, ...others] = ordered
        if (base !== undefined) {
          for (const other of others) {
            issues.push(
              ...compareTranslations(base.spec, other.spec).map((issue) => ({ index: other.index, issue })),
            )
          }
        }
        return { existing, plans, issues }
      })

      // The write: prepare every version, put the bodies in R2, then one D1 batch. A failure before
      // the batch leaves at most an orphaned content-addressed object, never a half-published lesson.
      const publishSpecs = Effect.fn("Lessons.publishSpecs")(function* (
        userId: UserId,
        slug: string,
        specs: ReadonlyArray<IndexedSpec>,
        pathPrefix: (index: number) => string,
      ) {
        const checked = yield* checkBundle(userId, slug, specs)
        if (checked.issues.length > 0) {
          return yield* new InvalidLesson({
            issues: checked.issues.map((planned) => issueWithPath(planned, pathPrefix)),
          })
        }

        const prepared = yield* Effect.forEach(
          checked.plans,
          (plan) =>
            Effect.gen(function* () {
              const canonical = canonicalJson(plan.spec)
              const hash = yield* Effect.promise(() => sha256Hex(canonical))
              return { ...plan, canonical, hash }
            }),
          { concurrency: 2 },
        )

        const existing = checked.existing
        const lessonId = Option.match(existing, {
          onNone: () => LessonId.make(uuidv7()),
          onSome: (row) => row.id,
        })
        const langs = prepared.map((plan) => plan.spec.lang)
        const currentRows =
          Option.isSome(existing) && langs.length > 0
            ? yield* db
                .query(
                  raw(sql`select ll.lang, v.id, v.body_hash from lesson_lang ll
                    join lesson_version v on v.id = ll.version_id
                    where ll.lesson_id = ${lessonId} and ll.lang in ${inList(langs)}`),
                  CurrentLangRow,
                )
                .pipe(Effect.orDie)
            : []
        const currentByLang = new Map(currentRows.map((row) => [row.lang, row]))
        const currentVersionIds = currentRows.map((row) => row.id)
        const currentPins =
          currentVersionIds.length === 0
            ? []
            : yield* db
                .query(
                  raw(sql`select lesson_version_id, card_id, concept_version_id
                    from lesson_version_concept
                    where lesson_version_id in ${inList(currentVersionIds)}`),
                  CurrentPinRow,
                )
                .pipe(Effect.orDie)

        const rows = prepared.map((plan) => {
          const current = currentByLang.get(plan.spec.lang)
          const unchanged =
            current !== undefined &&
            current.body_hash === plan.hash &&
            samePinSet(
              currentPins.filter((pin) => pin.lesson_version_id === current.id),
              plan.pins,
            )
          return {
            ...plan,
            created: !unchanged,
            versionId: unchanged && current !== undefined ? current.id : LessonVersionId.make(uuidv7()),
          }
        })

        // Bodies first: immutable, content-addressed, and safe to orphan if the batch fails.
        for (const row of rows) {
          if (!row.created) continue
          const key = contentKey(row.hash)
          if (!(yield* storage.exists(key).pipe(Effect.orDie))) {
            yield* storage
              .put(key, { body: row.canonical, contentType: "application/json" })
              .pipe(Effect.orDie)
          }
        }

        if (!rows.some((row) => row.created)) {
          return {
            lesson: yield* asUser.get(lessonId).pipe(Effect.orDie),
            versions: yield* Effect.forEach(rows, (row) =>
              version(lessonId, row.versionId).pipe(
                Effect.orDie,
                Effect.map((found) => ({ version: found, created: false })),
              ),
            ),
            created: false,
          } satisfies PublishLessonUnchanged
        }

        const now = Date.now()
        const first = rows[0]
        if (first === undefined) return yield* Effect.die(new Error("publish prepared no specs"))
        const defaultLang = Option.isSome(existing) ? existing.value.default_lang : first.spec.lang
        const titleRow = rows.find((row) => row.created && row.spec.lang === defaultLang)

        yield* db
          .batch([
            ...(Option.isNone(existing)
              ? [
                  // Two first publishes of one slug can race: the loser's insert hits the unique
                  // (owner_id, slug) and its batch fails; a retry finds the lesson and adds a
                  // version. Either way, a bundle never leaves a half-published lesson.
                  sqlBuilder.insert(lesson).values({
                    id: lessonId,
                    owner_id: userId,
                    slug,
                    kind: first.spec.kind,
                    default_lang: first.spec.lang,
                    title: first.spec.title,
                    summary: first.spec.summary,
                    visibility: "private",
                    created_at: now,
                    updated_at: now,
                  }),
                ]
              : []),
            ...rows
              .filter((row) => row.created)
              .flatMap((row, index) => {
                const bodyBytes = row.canonical.byteLength
                return [
                  raw(sql`insert into lesson_version
                    (id, lesson_id, lang, n, body_hash, body_bytes, schema, note, created_at)
                    select ${row.versionId}, ${lessonId}, ${row.spec.lang}, coalesce(max(n), 0) + 1,
                      ${row.hash}, ${bodyBytes}, ${lessonSchemaVersion}, null, ${now}
                    from lesson_version where lesson_id = ${lessonId} and lang = ${row.spec.lang}`),
                  raw(sql`insert into lesson_lang
                    (lesson_id, lang, version_id, title, summary, search, fts_rowid, updated_at)
                    values (${lessonId}, ${row.spec.lang}, ${row.versionId}, ${row.spec.title},
                      ${row.spec.summary}, ${lessonSearchText(row.spec.title, row.spec.summary)},
                      ${nextLessonFtsRowid} + ${index}, ${now})
                    on conflict (lesson_id, lang) do update set version_id = excluded.version_id,
                      title = excluded.title, summary = excluded.summary, search = excluded.search,
                      fts_rowid = coalesce(lesson_lang.fts_rowid, excluded.fts_rowid),
                      updated_at = excluded.updated_at`),
                  ...row.pins.map((pin) =>
                    raw(sql`insert into lesson_version_concept
                      (lesson_version_id, card_id, concept_version_id)
                      values (${row.versionId}, ${pin.card_id}, ${pin.concept_version_id})`),
                  ),
                ]
              }),
            raw(sql`update lesson set updated_at = ${now},
              title = case when ${titleRow?.spec.title ?? null} is null then title
                else ${titleRow?.spec.title ?? null} end,
              summary = case when ${titleRow?.spec.summary ?? null} is null then summary
                else ${titleRow?.spec.summary ?? null} end
              where id = ${lessonId}`),
            ...syncLessonLangs(lessonId),
          ])
          .pipe(Effect.orDie)

        return {
          lesson: yield* asUser.get(lessonId).pipe(Effect.orDie),
          versions: yield* Effect.forEach(rows, (row) =>
            version(lessonId, row.versionId).pipe(
              Effect.orDie,
              Effect.map((found) => ({ version: found, created: row.created })),
            ),
          ),
          created: true,
        } satisfies PublishedLesson
      })

      // The old endpoint: one language per request. Kept for downloaded CLIs; the lesson-level
      // endpoint is the contract new clients use.
      const publish = Effect.fn("Lessons.publish")(function* (slug: string, body: Uint8Array) {
        const user = yield* CurrentUser
        const parsed = yield* parseSingle(body)
        if (parsed.spec === undefined) return yield* new InvalidLesson({ issues: parsed.issues })
        const published = yield* publishSpecs(user.id, slug, [parsed.spec], () => "")
        const first = published.versions[0]
        if (first === undefined) return yield* Effect.die(new Error("publish returned no version"))
        return first.created
          ? ({ lesson: published.lesson, version: first.version, created: true } satisfies Published)
          : ({ lesson: published.lesson, version: first.version, created: false } satisfies PublishUnchanged)
      })

      const publishBundle = Effect.fn("Lessons.publishBundle")(function* (slug: string, body: Uint8Array) {
        const user = yield* CurrentUser
        const parsed = yield* parseBundle(body)
        if (parsed.issues.length > 0) {
          return yield* new InvalidLesson({
            issues: parsed.issues.map((planned) => issueWithPath(planned, bundlePath)),
          })
        }
        return yield* publishSpecs(user.id, slug, parsed.specs, bundlePath)
      })

      const validate = Effect.fn("Lessons.validate")(function* (slug: string, body: Uint8Array) {
        const user = yield* CurrentUser
        const parsed = yield* parseBundle(body)
        const issues =
          parsed.issues.length > 0 ? parsed.issues : (yield* checkBundle(user.id, slug, parsed.specs)).issues
        return {
          valid: issues.length === 0,
          issues: issues.map((planned) => issueWithPath(planned, bundlePath)),
        }
      })

      return Lessons.of({ anonymous, asUser, update, remove, mine, publish, publishBundle, validate })
    }),
  )
}

const IdRow = Schema.Struct({ id: Schema.String })
const StoredLangRow = Schema.Struct({ lang: LessonLang, body_hash: Schema.String })
const CurrentLangRow = Schema.Struct({ lang: LessonLang, id: LessonVersionId, body_hash: Schema.String })
const CurrentPinRow = Schema.Struct({
  lesson_version_id: LessonVersionId,
  card_id: Schema.String,
  concept_version_id: ConceptVersionId,
})
const ConceptPinRow = Schema.Struct({
  slug: Schema.String,
  n: Schema.Int,
  version_id: ConceptVersionId,
  is_current: Schema.Int,
})
const PinnedRow = ConceptBundleItem.mapFields(({ spec: _spec, ...fields }) => fields)

// One lesson's share of the public counters (its tags' and its owner's lesson_count): 1 while it
// is public, else 0. A change takes the share out (-1) before it touches the lesson and puts it
// back (+1) after, in the same batch (one transaction). So each counter moves by at most one,
// reading only this lesson's rows, and stays exact without a count over every lesson.
const countedAs = (lessonId: LessonId, ownerId: UserId, sign: 1 | -1) => [
  raw(sql`update tag set lesson_count = lesson_count + ${sign}
    where id in (select tag_id from lesson_tag where lesson_id = ${lessonId} and is_public = 1)`),
  raw(sql`update profile set lesson_count = lesson_count + ${sign} where user_id = ${ownerId}
    and exists (select 1 from lesson where id = ${lessonId} and visibility = 'public' and deleted_at is null)`),
]

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
