import {
  category,
  conceptVersion,
  Db,
  type Drizzle,
  lesson,
  lessonLang,
  lessonTag,
  lessonVersion,
  lessonVersionConcept,
  profile,
  publicUser,
  sha256Hex,
  tag,
  uuidv7,
} from "@app/db"
import {
  type CategoryId,
  Conflict,
  type FeedSort,
  type Handle,
  Invalid,
  isConceptRef,
  type LessonDetail,
  type LessonId,
  type LessonKind,
  type LessonLang,
  LessonSpec,
  type LessonSummary,
  maxLessonBytes,
  maxTags,
  NotFound,
  parseConceptRef,
  richToPlain,
  TagSlug,
  translationIssues,
  utf8Length,
  type VersionId,
  type Visibility,
  validateLesson,
} from "@app/domain"
import { and, desc, eq, inArray, isNull, like, lt, or, type SQL, sql } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import { Clock, Context, Effect, Layer, Schema } from "effect"
import { Concepts } from "./concepts.ts"
import { Content, CurrentUser, type Reader } from "./context.ts"
import { decodeCursor, encodeCursor } from "./cursor.ts"
import { ftsQuery, normalizeTag, searchText } from "./search.ts"

const pageSize = 20

type LessonRow = typeof lesson.$inferSelect

export interface FeedParams {
  readonly sort?: FeedSort | undefined
  readonly kind?: LessonKind | undefined
  readonly lang?: LessonLang | undefined
  readonly categories?: ReadonlyArray<string> | undefined
  readonly tag?: string | undefined
  readonly q?: string | undefined
  readonly cursor?: string | undefined
}

export interface LessonPatch {
  readonly slug?: string
  readonly visibility?: Visibility
  readonly categoryId?: CategoryId | null
  readonly tags?: ReadonlyArray<string>
}

const decodeSpec = Schema.decodeUnknownSync(LessonSpec)

// D1 runs a batch as one transaction. Drizzle wants a non-empty tuple type.
type Batch = Array<BatchItem<"sqlite">>
const runBatch = (db: Drizzle, items: Batch): Promise<unknown> =>
  items.length === 0
    ? Promise.resolve([])
    : db.batch(items as [BatchItem<"sqlite">, ...Array<BatchItem<"sqlite">>])

// Text the search index gets for a lesson: problem statements go in their own column.
function problemText(spec: LessonSpec): string {
  return spec.sections
    .filter((s) => s.type === "problem")
    .map((s) => (s.type === "problem" ? richToPlain(s.body) : ""))
    .join("\n")
}

// FTS rows are replaced, never updated in place: delete then insert, in the same batch.
function ftsWrite(
  db: Drizzle,
  id: string,
  title: string,
  summary: string,
  tags: ReadonlyArray<string>,
  problem: string,
) {
  return [
    db.run(sql`delete from lesson_fts where lesson_id = ${id}`),
    db.run(
      sql`insert into lesson_fts (lesson_id, title, summary, tags, problem) values (${id}, ${searchText(title)}, ${searchText(summary)}, ${tags.join(" ")}, ${searchText(problem)})`,
    ),
  ]
}

// Recounts `concept.use_count` for some concepts: lessons whose current versions link them.
function conceptUseRecount(db: Drizzle, conceptIds: ReadonlyArray<string>) {
  if (conceptIds.length === 0) return []
  return [
    db.run(sql`update concept set use_count = (
      select count(distinct ll.lesson_id) from lesson_version_concept lvc
      join lesson_lang ll on ll.version_id = lvc.lesson_version_id
      join lesson l on l.id = ll.lesson_id and l.deleted_at is null
      join concept_version cv on cv.id = lvc.concept_version_id
      where cv.concept_id = concept.id and lvc.card_id is not null
    ) where id in (${sql.join(
      conceptIds.map((c) => sql`${c}`),
      sql`, `,
    )})`),
  ]
}

function tagRecount(db: Drizzle, tagIds: ReadonlyArray<string>) {
  if (tagIds.length === 0) return []
  return [
    db.run(sql`update tag set lesson_count = (
      select count(*) from lesson_tag lt where lt.tag_id = tag.id and lt.is_public = 1
    ) where id in (${sql.join(
      tagIds.map((t) => sql`${t}`),
      sql`, `,
    )})`),
  ]
}

export class Lessons extends Context.Service<
  Lessons,
  {
    readonly feed: (p: FeedParams) => Effect.Effect<{ items: Array<LessonSummary>; next: string | null }>
    readonly library: (
      cursor: string | undefined,
    ) => Effect.Effect<{ items: Array<LessonSummary>; next: string | null }, never, CurrentUser>
    readonly byHandle: (reader: Reader, handle: Handle, slug: string) => Effect.Effect<LessonDetail, NotFound>
    readonly byId: (reader: Reader, id: LessonId) => Effect.Effect<LessonDetail, NotFound>
    readonly body: (reader: Reader, id: LessonId, lang: LessonLang) => Effect.Effect<LessonSpec, NotFound>
    readonly create: (input: {
      readonly slug: string
      readonly spec: LessonSpec
      readonly note?: string | undefined
    }) => Effect.Effect<LessonDetail, Conflict | Invalid, CurrentUser>
    readonly addVersion: (
      id: LessonId,
      input: { readonly spec: LessonSpec; readonly note?: string | undefined },
    ) => Effect.Effect<LessonDetail, NotFound | Invalid, CurrentUser>
    readonly update: (
      id: LessonId,
      patch: LessonPatch,
    ) => Effect.Effect<LessonDetail, NotFound | Conflict | Invalid, CurrentUser>
    readonly remove: (id: LessonId) => Effect.Effect<void, NotFound, CurrentUser>
    readonly tags: (
      prefix: string | undefined,
    ) => Effect.Effect<Array<{ slug: TagSlug; lessonCount: number }>>
    // May /c/<hash>.json be served to anyone? True for public or unlisted lesson bodies and for
    // concept bodies; a private lesson's body is only reachable through `body`.
    readonly isPublicHash: (hash: string) => Effect.Effect<boolean>
    // The version a concept bundle belongs to, if the reader may see its lesson.
    readonly readableVersion: (reader: Reader, versionId: VersionId) => Effect.Effect<void, NotFound>
    readonly categories: () => Effect.Effect<Array<typeof category.$inferSelect>>
  }
>()("learn/services/Lessons") {
  static readonly layer = Layer.effect(
    Lessons,
    Effect.gen(function* () {
      const { drizzle: db, run, attempt } = yield* Db
      const content = yield* Content
      const concepts = yield* Concepts

      // Owner, languages and tags for a page of lessons: three queries, one round trip.
      const summarize = Effect.fnUntraced(function* (rows: ReadonlyArray<LessonRow>) {
        if (rows.length === 0) return [] as Array<LessonSummary>
        const ids = rows.map((r) => r.id)
        const owners = [...new Set(rows.map((r) => r.ownerId))]
        const [people, langs, tags] = yield* run(() =>
          db.batch([
            db
              .select({
                id: publicUser.id,
                name: publicUser.name,
                image: publicUser.image,
                handle: profile.handle,
              })
              .from(publicUser.table)
              .innerJoin(profile, eq(profile.userId, publicUser.id))
              .where(inArray(publicUser.id, owners)),
            db
              .select({ lessonId: lessonLang.lessonId, lang: lessonLang.lang })
              .from(lessonLang)
              .where(inArray(lessonLang.lessonId, ids)),
            db
              .select({ lessonId: lessonTag.lessonId, slug: tag.slug })
              .from(lessonTag)
              .innerJoin(tag, eq(tag.id, lessonTag.tagId))
              .where(inArray(lessonTag.lessonId, ids)),
          ]),
        )
        const person = new Map(people.map((p) => [p.id, p]))
        return rows.map(
          (r): LessonSummary => ({
            id: r.id as LessonId,
            slug: r.slug,
            owner: {
              handle: (person.get(r.ownerId)?.handle ?? "unknown") as Handle,
              name: person.get(r.ownerId)?.name ?? "",
              image: person.get(r.ownerId)?.image ?? null,
            },
            kind: r.kind,
            lang: r.lang,
            title: r.title,
            summary: r.summary,
            langs: langs.filter((l) => l.lessonId === r.id).map((l) => l.lang),
            visibility: r.visibility,
            categoryId: r.categoryId as CategoryId | null,
            tags: tags.filter((t) => t.lessonId === r.id).map((t) => t.slug as TagSlug),
            likeCount: r.likeCount,
            forkCount: r.forkCount,
            publishedAt: r.publishedAt,
            updatedAt: r.updatedAt,
          }),
        )
      })

      const detail = Effect.fnUntraced(function* (row: LessonRow, reader: Reader) {
        const [summary] = yield* summarize([row])
        const bodies = yield* run(() =>
          db
            .select({
              lang: lessonVersion.lang,
              versionId: lessonVersion.id,
              n: lessonVersion.n,
              hash: lessonVersion.bodyHash,
              bytes: lessonVersion.bodyBytes,
              title: lessonVersion.title,
              summary: lessonVersion.summary,
              createdAt: lessonVersion.createdAt,
            })
            .from(lessonLang)
            .innerJoin(lessonVersion, eq(lessonVersion.id, lessonLang.versionId))
            .where(eq(lessonLang.lessonId, row.id)),
        )
        return {
          ...(summary as LessonSummary),
          bodies: bodies.map((b) => ({ ...b, versionId: b.versionId as VersionId })),
          isOwner: reader?.userId === row.ownerId,
        } satisfies LessonDetail
      })

      // A lesson the reader may see. Private lessons are invisible to everyone but the owner: a
      // 404, not a 403, so their existence doesn't leak.
      const readable = (row: LessonRow | undefined, reader: Reader) =>
        row === undefined ||
        row.deletedAt !== null ||
        (row.visibility === "private" && row.ownerId !== reader?.userId)
          ? Effect.fail(new NotFound({ message: "lesson not found" }))
          : Effect.succeed(row)

      const owned = Effect.fnUntraced(function* (id: string) {
        const user = yield* CurrentUser
        const [row] = yield* run(() =>
          db
            .select()
            .from(lesson)
            .where(and(eq(lesson.id, id), isNull(lesson.deletedAt)))
            .limit(1),
        )
        if (row === undefined || row.ownerId !== user.userId)
          return yield* new NotFound({ message: "lesson not found" })
        return row
      })

      const getRow = (where: SQL | undefined) =>
        run(() => db.select().from(lesson).where(where).limit(1)).pipe(Effect.map((r) => r[0]))

      const feed = Effect.fn("Lessons.feed")(function* (p: FeedParams) {
        const hot = p.sort === "hot"
        const key = hot ? lesson.hotScore : lesson.publishedAt
        const conds: Array<SQL | undefined> = [eq(lesson.visibility, "public"), isNull(lesson.deletedAt)]
        if (p.kind) conds.push(eq(lesson.kind, p.kind))
        if (p.categories && p.categories.length > 0) conds.push(inArray(lesson.categoryId, [...p.categories]))
        if (p.lang)
          conds.push(
            sql`exists (select 1 from lesson_lang ll where ll.lesson_id = ${lesson.id} and ll.lang = ${p.lang})`,
          )
        if (p.tag)
          conds.push(
            sql`exists (select 1 from lesson_tag lt join tag t on t.id = lt.tag_id where lt.lesson_id = ${lesson.id} and t.slug = ${normalizeTag(p.tag)})`,
          )
        if (p.q !== undefined) {
          const match = ftsQuery(p.q)
          if (match === null) return { items: [], next: null }
          conds.push(sql`${lesson.id} in (select lesson_id from lesson_fts where lesson_fts match ${match})`)
        }
        const after = decodeCursor(p.cursor)
        if (after !== null) {
          const [k, id] = after
          if (typeof k === "number" && typeof id === "string")
            conds.push(or(lt(key, k), and(eq(key, k), lt(lesson.id, id))))
        }
        const rows = yield* run(() =>
          db
            .select()
            .from(lesson)
            .where(and(...conds))
            .orderBy(desc(key), desc(lesson.id))
            .limit(pageSize + 1),
        )
        const page = rows.slice(0, pageSize)
        const last = page[page.length - 1]
        return {
          items: yield* summarize(page),
          next:
            rows.length > pageSize && last
              ? encodeCursor([hot ? last.hotScore : (last.publishedAt ?? 0), last.id])
              : null,
        }
      })

      const library = Effect.fn("Lessons.library")(function* (cursor: string | undefined) {
        const user = yield* CurrentUser
        const conds: Array<SQL | undefined> = [eq(lesson.ownerId, user.userId), isNull(lesson.deletedAt)]
        const after = decodeCursor(cursor)
        if (after !== null) {
          const [k, id] = after
          if (typeof k === "number" && typeof id === "string")
            conds.push(or(lt(lesson.updatedAt, k), and(eq(lesson.updatedAt, k), lt(lesson.id, id))))
        }
        const rows = yield* run(() =>
          db
            .select()
            .from(lesson)
            .where(and(...conds))
            .orderBy(desc(lesson.updatedAt), desc(lesson.id))
            .limit(pageSize + 1),
        )
        const page = rows.slice(0, pageSize)
        const last = page[page.length - 1]
        return {
          items: yield* summarize(page),
          next: rows.length > pageSize && last ? encodeCursor([last.updatedAt, last.id]) : null,
        }
      })

      const byHandle = Effect.fn("Lessons.byHandle")(function* (
        reader: Reader,
        handle: Handle,
        slug: string,
      ) {
        const row = yield* run(() =>
          db
            .select({ lesson })
            .from(lesson)
            .innerJoin(profile, eq(profile.userId, lesson.ownerId))
            .where(and(eq(profile.handle, handle), eq(lesson.slug, slug)))
            .limit(1),
        ).pipe(Effect.map((r) => r[0]?.lesson))
        return yield* detail(yield* readable(row, reader), reader)
      })

      const byId = Effect.fn("Lessons.byId")(function* (reader: Reader, id: LessonId) {
        const row = yield* getRow(eq(lesson.id, id))
        return yield* detail(yield* readable(row, reader), reader)
      })

      const body = Effect.fn("Lessons.body")(function* (reader: Reader, id: LessonId, lang: LessonLang) {
        yield* readable(yield* getRow(eq(lesson.id, id)), reader)
        const [v] = yield* run(() =>
          db
            .select({ hash: lessonVersion.bodyHash })
            .from(lessonLang)
            .innerJoin(lessonVersion, eq(lessonVersion.id, lessonLang.versionId))
            .where(and(eq(lessonLang.lessonId, id), eq(lessonLang.lang, lang)))
            .limit(1),
        )
        if (v === undefined) return yield* new NotFound({ message: `no ${lang} version` })
        const text = yield* content.get(v.hash)
        if (text === null) return yield* Effect.die(new Error(`body ${v.hash} missing from R2`))
        return decodeSpec(JSON.parse(text))
      })

      // Everything a new version needs before it is written: rules checked, body stored, concept
      // versions resolved.
      const prepare = Effect.fnUntraced(function* (spec: LessonSpec) {
        const body = JSON.stringify(spec)
        const bytes = utf8Length(body)
        if (bytes > maxLessonBytes)
          return yield* new Invalid({
            message: `lesson is ${bytes} bytes, the limit is ${maxLessonBytes}`,
            issues: [],
          })
        const refs = Object.entries(spec.cards).flatMap(([cardId, c]) =>
          isConceptRef(c) ? [{ cardId, ...parseConceptRef(c.concept) }] : [],
        )
        const pins = yield* concepts.resolve(spec.lang, refs)
        const issues = [
          ...validateLesson(spec, { concepts: new Set(pins.direct.map((p) => p.slug)) }),
          ...pins.issues,
        ]
        if (issues.length > 0)
          return yield* new Invalid({ message: "the lesson has broken references", issues })
        const hash = yield* Effect.promise(() => sha256Hex(body))
        yield* content.put(hash, body)
        return { hash, bytes, pins }
      })

      const versionWrites = (
        lessonId: string,
        versionId: string,
        n: number,
        spec: LessonSpec,
        prepared: Effect.Success<ReturnType<typeof prepare>>,
        note: string | undefined,
        now: number,
      ): Batch => [
        db.insert(lessonVersion).values({
          id: versionId,
          lessonId,
          lang: spec.lang,
          n,
          bodyHash: prepared.hash,
          bodyBytes: prepared.bytes,
          schema: spec.schema,
          title: spec.title,
          summary: spec.summary,
          note: note ?? null,
          createdAt: now,
        }),
        db
          .insert(lessonLang)
          .values({ lessonId, lang: spec.lang, versionId })
          .onConflictDoUpdate({ target: [lessonLang.lessonId, lessonLang.lang], set: { versionId } }),
        ...[...prepared.pins.direct, ...prepared.pins.needed].map((p) =>
          db
            .insert(lessonVersionConcept)
            .values({ lessonVersionId: versionId, conceptVersionId: p.versionId, cardId: p.cardId })
            .onConflictDoNothing(),
        ),
      ]

      const currentTags = (id: string) =>
        run(() =>
          db
            .select({ id: tag.id, slug: tag.slug })
            .from(lessonTag)
            .innerJoin(tag, eq(tag.id, lessonTag.tagId))
            .where(eq(lessonTag.lessonId, id)),
        )

      const create = Effect.fn("Lessons.create")(function* (input: {
        readonly slug: string
        readonly spec: LessonSpec
        readonly note?: string | undefined
      }) {
        const user = yield* CurrentUser
        const { spec } = input
        const taken = yield* getRow(and(eq(lesson.ownerId, user.userId), eq(lesson.slug, input.slug)))
        if (taken !== undefined)
          return yield* new Conflict({ message: `you already have a lesson at /${input.slug}` })
        const prepared = yield* prepare(spec)
        const now = yield* Clock.currentTimeMillis
        const id = uuidv7(now)
        const versionId = uuidv7(now)
        yield* attempt(() =>
          runBatch(db, [
            db.insert(lesson).values({
              id,
              ownerId: user.userId,
              slug: input.slug,
              kind: spec.kind,
              lang: spec.lang,
              title: spec.title,
              summary: spec.summary,
              createdAt: now,
              updatedAt: now,
            }),
            ...versionWrites(id, versionId, 1, spec, prepared, input.note, now),
            db
              .update(profile)
              .set({ lessonCount: sql`${profile.lessonCount} + 1` })
              .where(eq(profile.userId, user.userId)),
            ...ftsWrite(db, id, spec.title, spec.summary, [], problemText(spec)),
            ...conceptUseRecount(
              db,
              prepared.pins.direct.map((p) => p.conceptId),
            ),
          ]),
        ).pipe(
          Effect.catchTag("DbError", (e) =>
            e.isUnique
              ? Effect.fail(new Conflict({ message: `you already have a lesson at /${input.slug}` }))
              : Effect.die(e),
          ),
        )
        return yield* byId({ userId: user.userId }, id as LessonId).pipe(Effect.orDie)
      })

      const addVersion = Effect.fn("Lessons.addVersion")(function* (
        id: LessonId,
        input: { readonly spec: LessonSpec; readonly note?: string | undefined },
      ) {
        const user = yield* CurrentUser
        const row = yield* owned(id)
        const { spec } = input
        if (spec.kind !== row.kind)
          return yield* new Invalid({
            message: `this lesson is a ${row.kind} lesson, not ${spec.kind}`,
            issues: [],
          })
        const langs = yield* run(() =>
          db
            .select({ lang: lessonVersion.lang, n: lessonVersion.n, hash: lessonVersion.bodyHash })
            .from(lessonLang)
            .innerJoin(lessonVersion, eq(lessonVersion.id, lessonLang.versionId))
            .where(eq(lessonLang.lessonId, id)),
        )
        const same = langs.find((l) => l.lang === spec.lang)
        // A new language is a translation: it must share every id with the original, so @refs and
        // comments mean the same thing in both. Later versions of one language may move ahead.
        if (same === undefined) {
          const original = langs.find((l) => l.lang === row.lang) ?? langs[0]
          if (original !== undefined) {
            const text = yield* content.get(original.hash)
            if (text !== null) {
              const issues = translationIssues(decodeSpec(JSON.parse(text)), spec)
              if (issues.length > 0)
                return yield* new Invalid({
                  message: `the ${spec.lang} translation doesn't match the original`,
                  issues,
                })
            }
          }
        }
        const prepared = yield* prepare(spec)
        const now = yield* Clock.currentTimeMillis
        const versionId = uuidv7(now)
        const before = yield* run(() =>
          db
            .select({ conceptId: conceptVersion.conceptId })
            .from(lessonVersionConcept)
            .innerJoin(lessonLang, eq(lessonLang.versionId, lessonVersionConcept.lessonVersionId))
            .innerJoin(conceptVersion, eq(conceptVersion.id, lessonVersionConcept.conceptVersionId))
            .where(eq(lessonLang.lessonId, id)),
        )
        const isFirstLang = spec.lang === row.lang
        const tags = yield* currentTags(id)
        yield* run(() =>
          runBatch(db, [
            ...versionWrites(id, versionId, (same?.n ?? 0) + 1, spec, prepared, input.note, now),
            db
              .update(lesson)
              .set(
                isFirstLang
                  ? { title: spec.title, summary: spec.summary, updatedAt: now }
                  : { updatedAt: now },
              )
              .where(eq(lesson.id, id)),
            ...(isFirstLang
              ? ftsWrite(
                  db,
                  id,
                  spec.title,
                  spec.summary,
                  tags.map((t) => t.slug),
                  problemText(spec),
                )
              : []),
            ...conceptUseRecount(db, [
              ...new Set([
                ...before.map((b) => b.conceptId),
                ...prepared.pins.direct.map((p) => p.conceptId),
              ]),
            ]),
          ]),
        )
        return yield* byId({ userId: user.userId }, id).pipe(Effect.orDie)
      })

      const update = Effect.fn("Lessons.update")(function* (id: LessonId, patch: LessonPatch) {
        const user = yield* CurrentUser
        const row = yield* owned(id)
        const now = yield* Clock.currentTimeMillis
        const visibility = patch.visibility ?? row.visibility
        const categoryId = patch.categoryId === undefined ? row.categoryId : patch.categoryId
        const oldTags = yield* currentTags(id)
        const tagSlugs =
          patch.tags === undefined
            ? oldTags.map((t) => t.slug)
            : [...new Set(patch.tags.map(normalizeTag))].filter(Boolean)

        const issues: Array<{ path: string; message: string }> = []
        if (tagSlugs.length > maxTags) issues.push({ path: "tags", message: `at most ${maxTags} tags` })
        for (const t of tagSlugs)
          if (!Schema.is(TagSlug)(t)) issues.push({ path: "tags", message: `"${t}" is not a valid tag` })
        if (visibility === "public") {
          if (categoryId === null)
            issues.push({ path: "categoryId", message: "a public lesson needs a category" })
          if (tagSlugs.length === 0)
            issues.push({ path: "tags", message: "a public lesson needs at least one tag" })
        }
        if (categoryId !== null && patch.categoryId !== undefined) {
          const [c] = yield* run(() =>
            db.select({ id: category.id }).from(category).where(eq(category.id, categoryId)),
          )
          if (c === undefined)
            issues.push({ path: "categoryId", message: `unknown category "${categoryId}"` })
        }
        if (issues.length > 0)
          return yield* new Invalid({ message: "the lesson can't be saved like this", issues })

        if (patch.slug !== undefined && patch.slug !== row.slug) {
          const taken = yield* getRow(and(eq(lesson.ownerId, user.userId), eq(lesson.slug, patch.slug)))
          if (taken !== undefined)
            return yield* new Conflict({ message: `you already have a lesson at /${patch.slug}` })
        }

        // The search row is rebuilt whole, so read the problem text from the first-language body.
        const [first] = yield* run(() =>
          db
            .select({ hash: lessonVersion.bodyHash })
            .from(lessonLang)
            .innerJoin(lessonVersion, eq(lessonVersion.id, lessonLang.versionId))
            .where(and(eq(lessonLang.lessonId, id), eq(lessonLang.lang, row.lang))),
        )
        const firstBody = first === undefined ? null : yield* content.get(first.hash)
        const problem = firstBody === null ? "" : problemText(decodeSpec(JSON.parse(firstBody)))

        const publishedAt = visibility === "public" ? (row.publishedAt ?? now) : row.publishedAt
        const isPublic = visibility === "public" ? 1 : 0
        const touchedTags = [...new Set([...tagSlugs, ...oldTags.map((t) => t.slug)])]
        const writes: Batch = [
          db
            .update(lesson)
            .set({ slug: patch.slug ?? row.slug, visibility, categoryId, publishedAt, updatedAt: now })
            .where(eq(lesson.id, id)),
          ...tagSlugs.map((slug) =>
            db
              .insert(tag)
              .values({ id: uuidv7(now), slug, name: slug })
              .onConflictDoNothing({ target: tag.slug }),
          ),
          db.delete(lessonTag).where(eq(lessonTag.lessonId, id)),
          // Feed columns are copied onto lesson_tag, so a tag feed reads one index.
          ...tagSlugs.map((slug) =>
            db.run(sql`insert into lesson_tag (lesson_id, tag_id, is_public, published_at, hot_score)
              select ${id}, t.id, ${isPublic}, ${publishedAt}, ${row.hotScore} from tag t where t.slug = ${slug}`),
          ),
          ...ftsWrite(db, id, row.title, row.summary, tagSlugs, problem),
          ...(touchedTags.length === 0
            ? []
            : [
                db.run(
                  sql`update tag set lesson_count = (select count(*) from lesson_tag lt where lt.tag_id = tag.id and lt.is_public = 1)
                    where slug in (${sql.join(
                      touchedTags.map((t) => sql`${t}`),
                      sql`, `,
                    )})`,
                ),
              ]),
        ]
        yield* attempt(() => runBatch(db, writes)).pipe(
          Effect.catchTag("DbError", (e) =>
            e.isUnique
              ? Effect.fail(new Conflict({ message: `you already have a lesson at /${patch.slug}` }))
              : Effect.die(e),
          ),
        )
        return yield* byId({ userId: user.userId }, id).pipe(Effect.orDie)
      })

      const remove = Effect.fn("Lessons.remove")(function* (id: LessonId) {
        const user = yield* CurrentUser
        yield* owned(id)
        const now = yield* Clock.currentTimeMillis
        const tags = yield* currentTags(id)
        const used = yield* run(() =>
          db
            .select({ conceptId: conceptVersion.conceptId })
            .from(lessonVersionConcept)
            .innerJoin(lessonLang, eq(lessonLang.versionId, lessonVersionConcept.lessonVersionId))
            .innerJoin(conceptVersion, eq(conceptVersion.id, lessonVersionConcept.conceptVersionId))
            .where(eq(lessonLang.lessonId, id)),
        )
        yield* run(() =>
          runBatch(db, [
            db.update(lesson).set({ deletedAt: now, updatedAt: now }).where(eq(lesson.id, id)),
            db.update(lessonTag).set({ isPublic: 0 }).where(eq(lessonTag.lessonId, id)),
            db
              .update(profile)
              .set({ lessonCount: sql`max(${profile.lessonCount} - 1, 0)` })
              .where(eq(profile.userId, user.userId)),
            db.run(sql`delete from lesson_fts where lesson_id = ${id}`),
            ...tagRecount(
              db,
              tags.map((t) => t.id),
            ),
            ...conceptUseRecount(db, [...new Set(used.map((u) => u.conceptId))]),
          ]),
        )
      })

      const tags = Effect.fn("Lessons.tags")(function* (prefix: string | undefined) {
        const p = normalizeTag(prefix ?? "")
        const rows = yield* run(() =>
          db
            .select({ slug: tag.slug, lessonCount: tag.lessonCount })
            .from(tag)
            .where(p === "" ? undefined : like(tag.slug, `${p.replace(/[%_]/g, "")}%`))
            .orderBy(desc(tag.lessonCount), tag.slug)
            .limit(20),
        )
        return rows.map((r) => ({ slug: r.slug as TagSlug, lessonCount: r.lessonCount }))
      })

      const isPublicHash = Effect.fn("Lessons.isPublicHash")(function* (hash: string) {
        const [l, c] = yield* run(() =>
          db.batch([
            db
              .select({ one: sql<number>`1` })
              .from(lessonVersion)
              .innerJoin(lesson, eq(lesson.id, lessonVersion.lessonId))
              .where(
                and(
                  eq(lessonVersion.bodyHash, hash),
                  inArray(lesson.visibility, ["public", "unlisted"]),
                  isNull(lesson.deletedAt),
                ),
              )
              .limit(1),
            db
              .select({ one: sql<number>`1` })
              .from(conceptVersion)
              .where(eq(conceptVersion.bodyHash, hash))
              .limit(1),
          ]),
        )
        return l.length > 0 || c.length > 0
      })

      const readableVersion = Effect.fn("Lessons.readableVersion")(function* (
        reader: Reader,
        versionId: VersionId,
      ) {
        const row = yield* run(() =>
          db
            .select({ lesson })
            .from(lessonVersion)
            .innerJoin(lesson, eq(lesson.id, lessonVersion.lessonId))
            .where(eq(lessonVersion.id, versionId))
            .limit(1),
        ).pipe(Effect.map((r) => r[0]?.lesson))
        yield* readable(row, reader)
      })

      const categories = () => run(() => db.select().from(category).orderBy(category.sort))

      return Lessons.of({
        feed,
        library,
        byHandle,
        byId,
        body,
        create,
        addVersion,
        update,
        remove,
        tags,
        isPublicHash,
        readableVersion,
        categories,
      })
    }),
  )
}
