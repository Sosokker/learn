import {
  BodyHash,
  CategoryId,
  type FeedCursor,
  Handle,
  LessonId,
  LessonLangInfo,
  type LessonPage,
  LessonSlug,
  type LessonSummary,
  LessonVersion,
  Millis,
  Visibility,
} from "@app/api"
import { type Database, raw } from "@app/db"
import { LessonKind, LessonLang } from "@app/domain"
import { type SQL, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"

// Row decoders and SQL fragments shared by Lessons and Feeds. Rows are keyed by result column
// name, so every select below names (or aliases) the column the decoder expects.

export const LessonRow = Schema.Struct({
  id: LessonId,
  owner_id: Schema.String,
  owner_handle: Handle,
  slug: LessonSlug,
  kind: LessonKind,
  default_lang: LessonLang,
  title: Schema.String,
  summary: Schema.String,
  category_id: Schema.NullOr(CategoryId),
  visibility: Visibility,
  like_count: Schema.Int,
  hot_score: Schema.Number,
  published_at: Schema.NullOr(Millis),
  created_at: Millis,
  updated_at: Millis,
})
export type LessonRow = typeof LessonRow.Type

export const lessonColumns = sql`l.id, l.owner_id, p.handle as owner_handle, l.slug, l.kind, l.default_lang, l.title,
  l.summary, l.category_id, l.visibility, l.like_count, l.hot_score, l.published_at, l.created_at, l.updated_at`

export const lessonFrom = sql`lesson l join profile p on p.user_id = l.owner_id`

// Who may read a lesson row: anyone for public and unlisted; its owner for private.
export const readableBy = (viewer: string | undefined): SQL =>
  viewer === undefined
    ? sql`l.deleted_at is null and l.visibility <> 'private'`
    : sql`l.deleted_at is null and (l.visibility <> 'private' or l.owner_id = ${viewer})`

export const inList = (values: ReadonlyArray<string>): SQL =>
  sql`(${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`

export const LangRow = Schema.Struct({ lesson_id: LessonId, ...LessonLangInfo.fields })
export const TagRow = Schema.Struct({ lesson_id: LessonId, slug: Schema.String })
export const VersionRow = LessonVersion
export const HashRow = Schema.Struct({ body_hash: BodyHash })

// The languages and tags of a set of lessons, two queries for the whole page.
export const langsAndTags = Effect.fn("Lessons.langsAndTags")(function* (
  db: Database["Service"],
  ids: ReadonlyArray<string>,
) {
  if (ids.length === 0) return { langs: [], tags: [] }
  return yield* Effect.all(
    {
      langs: db.query(
        raw(sql`select ll.lesson_id, ll.lang, ll.version_id, v.n, v.body_hash, ll.title, ll.summary, ll.updated_at
          from lesson_lang ll join lesson_version v on v.id = ll.version_id
          where ll.lesson_id in ${inList(ids)} order by ll.lang`),
        LangRow,
      ),
      tags: db.query(
        raw(sql`select lt.lesson_id, t.slug from lesson_tag lt join tag t on t.id = lt.tag_id
          where lt.lesson_id in ${inList(ids)} order by t.slug`),
        TagRow,
      ),
    },
    { concurrency: "unbounded" },
  )
})

// Keyset page: query `limit + 1` rows; the extra row only says whether another page exists.
export const toLessonPage = Effect.fn("Lessons.toPage")(function* (
  db: Database["Service"],
  rows: ReadonlyArray<LessonRow>,
  limit: number,
  sortKey: (row: LessonRow) => number,
) {
  const items = rows.slice(0, limit)
  const extra = yield* langsAndTags(
    db,
    items.map((row) => row.id),
  )
  const last = items.at(-1)
  const page: LessonPage = {
    items: items.map(
      (row): LessonSummary => ({
        id: row.id,
        owner_handle: row.owner_handle,
        slug: row.slug,
        kind: row.kind,
        default_lang: row.default_lang,
        title: row.title,
        summary: row.summary,
        category_id: row.category_id,
        visibility: row.visibility,
        tags: extra.tags.filter((tag) => tag.lesson_id === row.id).map((tag) => tag.slug),
        langs: extra.langs.filter((lang) => lang.lesson_id === row.id).map((lang) => lang.lang),
        like_count: row.like_count,
        published_at: row.published_at,
        updated_at: row.updated_at,
      }),
    ),
    next_cursor: rows.length > limit && last !== undefined ? { at: sortKey(last), id: last.id } : null,
  }
  return page
})

// `(sort, id) < (cursor.at, cursor.id)`: SQLite compares row values, and the condition is an
// index range on (…, sort, id), so a deep page costs the same as the first.
export const after = (sortColumn: SQL, idColumn: SQL, cursor: FeedCursor | undefined): SQL =>
  cursor === undefined ? sql`1 = 1` : sql`(${sortColumn}, ${idColumn}) < (${cursor.at}, ${cursor.id})`
