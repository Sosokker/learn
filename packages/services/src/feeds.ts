import { CategoryNotFound, defaultPageLimit, type FeedCursor, type LessonPage } from "@app/api"
import { Database, raw } from "@app/db"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { after, inList, LessonRow, lessonColumns, lessonFrom, toLessonPage } from "./rows.ts"
import { normalizeTag } from "./tags.ts"

export interface PageOptions {
  readonly cursor?: FeedCursor | undefined
  readonly limit?: number | undefined
}

// Public lessons only, newest first by first-public time, in keyset pages. Each feed reads one
// partial index (public rows only): lesson_new_idx, lesson_cat_idx, lesson_tag_feed_idx.
export class Feeds extends Context.Service<
  Feeds,
  {
    readonly latest: (options: PageOptions) => Effect.Effect<LessonPage>
    // The category and every category under it (ids are dotted paths).
    readonly category: (id: string, options: PageOptions) => Effect.Effect<LessonPage, CategoryNotFound>
    // An unknown tag is an empty page, like a tag on private lessons only: a 404 would tell
    // whether some private lesson uses it.
    readonly tag: (slug: string, options: PageOptions) => Effect.Effect<LessonPage>
  }
>()("@app/services/Feeds") {
  static readonly layer = Layer.effect(
    Feeds,
    Effect.gen(function* () {
      const db = yield* Database
      const publicLesson = sql`l.visibility = 'public' and l.deleted_at is null`

      const page = (where: ReturnType<typeof sql>, options: PageOptions) =>
        Effect.gen(function* () {
          const limit = options.limit ?? defaultPageLimit
          const rows = yield* db.query(
            raw(sql`select ${lessonColumns} from ${lessonFrom}
              where ${publicLesson} and ${where} and ${after(sql`l.published_at`, sql`l.id`, options.cursor)}
              order by l.published_at desc, l.id desc limit ${limit + 1}`),
            LessonRow,
          )
          return yield* toLessonPage(db, rows, limit, (row) => row.published_at ?? 0)
        }).pipe(Effect.orDie)

      return Feeds.of({
        latest: Effect.fn("Feeds.latest")(function* (options: PageOptions) {
          return yield* page(sql`1 = 1`, options)
        }),
        category: Effect.fn("Feeds.category")(function* (id: string, options: PageOptions) {
          // The category and its descendants (dotted ids), then one index range per category.
          const ids = yield* db
            .query(raw(sql`select id from category where id = ${id} or id like ${`${id}.%`}`), IdRow)
            .pipe(Effect.orDie)
          if (ids.length === 0) return yield* new CategoryNotFound()
          return yield* page(sql`l.category_id in ${inList(ids.map((row) => row.id))}`, options)
        }),
        tag: Effect.fn("Feeds.tag")(function* (slug: string, options: PageOptions) {
          const tags = yield* db
            .query(raw(sql`select id from tag where slug = ${normalizeTag(slug)}`), IdRow)
            .pipe(Effect.orDie)
          const tag = tags[0]
          if (tag === undefined) return { items: [], next_cursor: null }
          const limit = options.limit ?? defaultPageLimit
          // The tag index holds copies of published_at, so the page is found in the index and
          // only `limit + 1` lesson rows are read.
          const rows = yield* db
            .query(
              raw(sql`select ${lessonColumns} from lesson_tag lt
                join lesson l on l.id = lt.lesson_id join profile p on p.user_id = l.owner_id
                where lt.tag_id = ${tag.id} and lt.is_public = 1 and ${publicLesson}
                  and ${after(sql`lt.published_at`, sql`lt.lesson_id`, options.cursor)}
                order by lt.published_at desc, lt.lesson_id desc limit ${limit + 1}`),
              LessonRow,
            )
            .pipe(Effect.orDie)
          return yield* toLessonPage(db, rows, limit, (row) => row.published_at ?? 0).pipe(Effect.orDie)
        }),
      })
    }),
  )
}

const IdRow = Schema.Struct({ id: Schema.String })
