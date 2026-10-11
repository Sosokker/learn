import {
  CategoryNotFound,
  defaultPageLimit,
  type FeedCursor,
  type FeedSort,
  type LessonPage,
  UnsupportedFilter,
} from "@app/api"
import { Database, raw } from "@app/db"
import type { LessonKind, LessonLang } from "@app/domain"
import { type SQL, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { after, LessonRow, lessonColumns, lessonColumnsWith, lessonFrom, toLessonPage } from "./rows.ts"
import { normalizeTag } from "./tags.ts"

export interface PageOptions {
  readonly cursor?: FeedCursor | undefined
  readonly limit?: number | undefined
}

// Public lessons only, in keyset pages. Every feed, filter and sort is one range of an index of
// public rows only, read in feed order (no sort), so a page reads about `limit + 1` lessons:
//
//   new                 lesson_new_idx            (published_at, id)
//   new ?kind=          lesson_kind_idx           (kind, published_at, id)
//   new ?lang=          lesson_lang_feed_idx      (lang, published_at, lesson_id) on lesson_lang
//   hot                 lesson_hot_idx            (hot_score, id)
//   hot ?kind=          lesson_kind_hot_idx       (kind, hot_score, id)
//   category            lesson_category_feed_idx  (category_id, published_at, lesson_id)
//   tag / tag ?sort=hot lesson_tag_feed_idx / lesson_tag_hot_idx
//
// Not offered, because no index covers them: kind and lang together, hot by lang (lesson_lang
// has no hot_score copy; the cron would have to keep one), hot by category (same, for
// lesson_category), and kind or lang on category and tag feeds. Each would read rows that the page
// then drops, so the cost grows with the rows skipped, not the page.
export class Feeds extends Context.Service<
  Feeds,
  {
    readonly latest: (
      options: PageOptions & {
        readonly kind?: LessonKind | undefined
        readonly lang?: LessonLang | undefined
      },
    ) => Effect.Effect<LessonPage, UnsupportedFilter>
    readonly hot: (
      options: PageOptions & { readonly kind?: LessonKind | undefined },
    ) => Effect.Effect<LessonPage>
    // The category and every category under it (ids are dotted paths).
    readonly category: (id: string, options: PageOptions) => Effect.Effect<LessonPage, CategoryNotFound>
    // An unknown tag is an empty page, like a tag on private lessons only: a 404 would tell
    // whether some private lesson uses it.
    readonly tag: (
      slug: string,
      options: PageOptions & { readonly sort?: FeedSort | undefined },
    ) => Effect.Effect<LessonPage>
  }
>()("@app/services/Feeds") {
  static readonly layer = Layer.effect(
    Feeds,
    Effect.gen(function* () {
      const db = yield* Database
      const publicLesson = sql`l.visibility = 'public' and l.deleted_at is null`

      // Runs one feed query and turns it into a page; `sortKey` reads the cursor value off a row.
      const run = (query: SQL, limit: number, sortKey: (row: LessonRow) => number) =>
        db.query(raw(query), LessonRow).pipe(
          Effect.flatMap((rows) => toLessonPage(db, rows, limit, sortKey)),
          Effect.orDie,
        )
      const byPublished = (row: LessonRow) => row.published_at ?? 0
      const byHot = (row: LessonRow) => row.hot_score

      return Feeds.of({
        latest: Effect.fn("Feeds.latest")(function* (options) {
          const limit = options.limit ?? defaultPageLimit
          if (options.kind !== undefined && options.lang !== undefined) {
            return yield* new UnsupportedFilter({ message: "filter by kind or by language, not both" })
          }
          if (options.lang !== undefined) {
            // lesson_lang keeps copies of is_public and published_at, so the language's feed is one
            // range of its index; each row shows that language's title and summary.
            return yield* run(
              sql`select ${lessonColumnsWith({ text: sql`ll` })} from lesson_lang ll
                join lesson l on l.id = ll.lesson_id join profile p on p.user_id = l.owner_id
                where ll.lang = ${options.lang} and ll.is_public = 1 and ${publicLesson}
                  and ${after(sql`ll.published_at`, sql`ll.lesson_id`, options.cursor)}
                order by ll.published_at desc, ll.lesson_id desc limit ${limit + 1}`,
              limit,
              byPublished,
            )
          }
          const kind = options.kind === undefined ? sql`` : sql`and l.kind = ${options.kind}`
          return yield* run(
            sql`select ${lessonColumns} from ${lessonFrom}
              where ${publicLesson} ${kind} and ${after(sql`l.published_at`, sql`l.id`, options.cursor)}
              order by l.published_at desc, l.id desc limit ${limit + 1}`,
            limit,
            byPublished,
          )
        }),
        hot: Effect.fn("Feeds.hot")(function* (options) {
          const limit = options.limit ?? defaultPageLimit
          const kind = options.kind === undefined ? sql`` : sql`and l.kind = ${options.kind}`
          return yield* run(
            sql`select ${lessonColumns} from ${lessonFrom}
              where ${publicLesson} ${kind} and ${after(sql`l.hot_score`, sql`l.id`, options.cursor)}
              order by l.hot_score desc, l.id desc limit ${limit + 1}`,
            limit,
            byHot,
          )
        }),
        category: Effect.fn("Feeds.category")(function* (id: string, options: PageOptions) {
          const found = yield* db
            .query(raw(sql`select id from category where id = ${id}`), IdRow)
            .pipe(Effect.orDie)
          if (found.length === 0) return yield* new CategoryNotFound()
          const limit = options.limit ?? defaultPageLimit
          // lesson_category lists each public lesson under its category and every ancestor, with a
          // copy of published_at, so a parent's feed is one index range in feed order (no sort)
          // and only `limit + 1` lesson rows are read.
          return yield* run(
            sql`select ${lessonColumns} from lesson_category lc
              join lesson l on l.id = lc.lesson_id join profile p on p.user_id = l.owner_id
              where lc.category_id = ${id} and ${publicLesson}
                and ${after(sql`lc.published_at`, sql`lc.lesson_id`, options.cursor)}
              order by lc.published_at desc, lc.lesson_id desc limit ${limit + 1}`,
            limit,
            byPublished,
          )
        }),
        tag: Effect.fn("Feeds.tag")(function* (slug: string, options) {
          const tags = yield* db
            .query(raw(sql`select id from tag where slug = ${normalizeTag(slug)}`), IdRow)
            .pipe(Effect.orDie)
          const tag = tags[0]
          if (tag === undefined) return { items: [], next_cursor: null }
          const limit = options.limit ?? defaultPageLimit
          // The tag index holds copies of published_at and hot_score, so the page is found in the
          // index and only `limit + 1` lesson rows are read. The hot sort pages on the copy.
          const hot = options.sort === "hot"
          const sortColumn = hot ? sql`lt.hot_score` : sql`lt.published_at`
          return yield* run(
            sql`select ${lessonColumnsWith(hot ? { hotScore: sql`lt.hot_score` } : {})} from lesson_tag lt
              join lesson l on l.id = lt.lesson_id join profile p on p.user_id = l.owner_id
              where lt.tag_id = ${tag.id} and lt.is_public = 1 and ${publicLesson}
                and ${after(sortColumn, sql`lt.lesson_id`, options.cursor)}
              order by ${sortColumn} desc, lt.lesson_id desc limit ${limit + 1}`,
            limit,
            hot ? byHot : byPublished,
          )
        }),
      })
    }),
  )
}

const IdRow = Schema.Struct({ id: Schema.String })
