import {
  CurrentUser,
  defaultPageLimit,
  LessonId,
  LessonNotFound,
  type LessonPage,
  LessonVersionId,
  type LikeState,
  Millis,
  type Progress,
  type ProgressPage,
  type ProgressUpdate,
  SectionId,
  type UserId,
  VersionNotFound,
  type ViewerState,
} from "@app/api"
import { Database, raw } from "@app/db"
import { LessonLang } from "@app/domain"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import type { PageOptions } from "./feeds.ts"
import { after, LessonRow, lessonColumns, readableBy, stillReadable, toLessonPage } from "./rows.ts"

// The stored `progress.state`: what Progress.save was given, normalized (seen ids unique and
// sorted), plus the version's language. Equal progress is an equal string, so the upsert can
// skip unchanged rows.
const ProgressState = Schema.Struct({
  lang: LessonLang,
  last: Schema.NullOr(SectionId),
  seen: Schema.Array(SectionId),
  total: Schema.Int,
})
const ProgressStateJson = Schema.fromJsonString(ProgressState)
const encodeState = Schema.encodeSync(ProgressStateJson)
const decodeState = Schema.decodeUnknownEffect(ProgressStateJson)

const toProgress = (row: {
  readonly version_id: LessonVersionId
  readonly state: string
  readonly done: number
  readonly updated_at: number
}) =>
  decodeState(row.state).pipe(
    Effect.map(
      (state): Progress => ({
        version_id: row.version_id,
        lang: state.lang,
        last: state.last,
        seen: state.seen,
        total: state.total,
        done: row.done === 1,
        updated_at: row.updated_at,
      }),
    ),
    // Written by Progress.save only, so a row that does not decode is a defect.
    Effect.orDie,
  )

const ViewerRow = Schema.Struct({
  liked: Schema.Int,
  bookmarked: Schema.Int,
  version_id: Schema.NullOr(LessonVersionId),
  state: Schema.NullOr(Schema.String),
  done: Schema.NullOr(Schema.Int),
  updated_at: Schema.NullOr(Millis),
})

// The signed-in reader's like, bookmark and progress on one lesson: one query, four primary-key
// lookups. Lessons adds it to every lesson read by a signed-in user.
export const viewerStateOf = Effect.fn("Engagement.viewerState")(function* (
  db: Database["Service"],
  lessonId: LessonId,
  userId: UserId,
) {
  const rows = yield* db
    .query(
      raw(sql`select
          exists (select 1 from lesson_like where user_id = ${userId} and lesson_id = ${lessonId}) as liked,
          exists (select 1 from bookmark where user_id = ${userId} and lesson_id = ${lessonId}) as bookmarked,
          pr.version_id, pr.state, pr.done, pr.updated_at
        from lesson l left join progress pr on pr.user_id = ${userId} and pr.lesson_id = l.id
        where l.id = ${lessonId}`),
      ViewerRow,
    )
    .pipe(Effect.orDie)
  const row = rows[0]
  if (row === undefined) return yield* Effect.die(new Error("viewer state query returned no row"))
  const progress =
    row.version_id === null || row.state === null || row.done === null || row.updated_at === null
      ? null
      : yield* toProgress({
          version_id: row.version_id,
          state: row.state,
          done: row.done,
          updated_at: row.updated_at,
        })
  const state: ViewerState = { liked: row.liked === 1, bookmarked: row.bookmarked === 1, progress }
  return state
})

const IdRow = Schema.Struct({ id: LessonId })
const TargetRow = Schema.Struct({ id: LessonId, lang: Schema.NullOr(LessonLang) })
const LikeRow = Schema.Struct({ like_count: Schema.Int, liked: Schema.Int })
const BookmarkRow = Schema.Struct({ ...LessonRow.fields, sort_at: Millis })
const ProgressRow = Schema.Struct({
  ...LessonRow.fields,
  sort_at: Millis,
  progress_version_id: LessonVersionId,
  progress_state: Schema.String,
})

// Likes, bookmarks and reading progress of the signed-in user. Every write first checks that the
// user can read the lesson (public, unlisted, or their own), with the same 404 as a lesson read, so
// none of these endpoints tells whether someone else's private lesson exists.
//
// `lesson.like_count` changes in the same batch as the like row, guarded by whether the row
// exists: the update runs before the insert (or delete) and only when the insert (delete) will
// change something. A batch is one transaction, so a repeated like or unlike moves nothing and
// the count stays equal to the rows without ever counting them.
//
// Every write repeats the read check inside its own statements (stillReadable), so a lesson deleted
// or made private between the check and the batch gets no new row and no counter change. The check
// before stays for the 404.
export class Engagement extends Context.Service<
  Engagement,
  {
    readonly like: (id: LessonId) => Effect.Effect<LikeState, LessonNotFound, CurrentUser>
    readonly unlike: (id: LessonId) => Effect.Effect<LikeState, LessonNotFound, CurrentUser>
    readonly bookmark: (id: LessonId) => Effect.Effect<void, LessonNotFound, CurrentUser>
    readonly unbookmark: (id: LessonId) => Effect.Effect<void, LessonNotFound, CurrentUser>
    readonly bookmarks: (options: PageOptions) => Effect.Effect<LessonPage, never, CurrentUser>
    readonly saveProgress: (
      id: LessonId,
      update: ProgressUpdate,
    ) => Effect.Effect<void, LessonNotFound | VersionNotFound, CurrentUser>
    readonly progress: (options: PageOptions) => Effect.Effect<ProgressPage, never, CurrentUser>
  }
>()("@app/services/Engagement") {
  static readonly layer = Layer.effect(
    Engagement,
    Effect.gen(function* () {
      const db = yield* Database

      const readable = Effect.fn("Engagement.readable")(function* (id: LessonId, userId: UserId) {
        const rows = yield* db
          .query(raw(sql`select l.id from lesson l where l.id = ${id} and ${readableBy(userId)}`), IdRow)
          .pipe(Effect.orDie)
        if (rows.length === 0) return yield* new LessonNotFound()
      })

      // Read with the same check, so a lesson that went away during the write is the 404 here.
      const likeState = Effect.fn("Engagement.likeState")(function* (id: LessonId, userId: UserId) {
        const rows = yield* db
          .query(
            raw(sql`select l.like_count,
                exists (select 1 from lesson_like where user_id = ${userId} and lesson_id = ${id}) as liked
              from lesson l where l.id = ${id} and ${readableBy(userId)}`),
            LikeRow,
          )
          .pipe(Effect.orDie)
        const row = rows[0]
        if (row === undefined) return yield* new LessonNotFound()
        const state: LikeState = { liked: row.liked === 1, like_count: row.like_count }
        return state
      })

      const hasLike = (id: LessonId, userId: UserId) =>
        sql`exists (select 1 from lesson_like where user_id = ${userId} and lesson_id = ${id})`

      const like = Effect.fn("Engagement.like")(function* (id: LessonId) {
        const user = yield* CurrentUser
        yield* readable(id, user.id)
        yield* db
          .batch([
            raw(
              sql`update lesson set like_count = like_count + 1 where id = ${id} and not ${hasLike(id, user.id)}
                and ${stillReadable(id, user.id)}`,
            ),
            raw(sql`insert into lesson_like (user_id, lesson_id, created_at)
              select ${user.id}, ${id}, ${Date.now()} where ${stillReadable(id, user.id)}
              on conflict (user_id, lesson_id) do nothing`),
          ])
          .pipe(Effect.orDie)
        return yield* likeState(id, user.id)
      })

      const unlike = Effect.fn("Engagement.unlike")(function* (id: LessonId) {
        const user = yield* CurrentUser
        yield* readable(id, user.id)
        yield* db
          .batch([
            raw(
              sql`update lesson set like_count = like_count - 1 where id = ${id} and ${hasLike(id, user.id)}
                and ${stillReadable(id, user.id)}`,
            ),
            raw(sql`delete from lesson_like where user_id = ${user.id} and lesson_id = ${id}
              and ${stillReadable(id, user.id)}`),
          ])
          .pipe(Effect.orDie)
        return yield* likeState(id, user.id)
      })

      const bookmark = Effect.fn("Engagement.bookmark")(function* (id: LessonId) {
        const user = yield* CurrentUser
        yield* readable(id, user.id)
        yield* db
          .run(
            raw(sql`insert into bookmark (user_id, lesson_id, created_at)
              select ${user.id}, ${id}, ${Date.now()} where ${stillReadable(id, user.id)}
              on conflict (user_id, lesson_id) do nothing`),
          )
          .pipe(Effect.orDie)
      })

      const unbookmark = Effect.fn("Engagement.unbookmark")(function* (id: LessonId) {
        const user = yield* CurrentUser
        yield* readable(id, user.id)
        yield* db
          .run(
            raw(sql`delete from bookmark where user_id = ${user.id} and lesson_id = ${id}
              and ${stillReadable(id, user.id)}`),
          )
          .pipe(Effect.orDie)
      })

      // A range of bookmark_user_idx in order, joined to each lesson by primary key. A bookmark
      // of a lesson the user can no longer read (made private, deleted) is skipped, never shown.
      const bookmarks = Effect.fn("Engagement.bookmarks")(function* (options: PageOptions) {
        const user = yield* CurrentUser
        const limit = options.limit ?? defaultPageLimit
        const rows = yield* db
          .query(
            raw(sql`select ${lessonColumns}, b.created_at as sort_at
              from bookmark b
              join lesson l on l.id = b.lesson_id
              join profile p on p.user_id = l.owner_id
              where b.user_id = ${user.id} and ${readableBy(user.id)}
                and ${after(sql`b.created_at`, sql`b.lesson_id`, options.cursor)}
              order by b.created_at desc, b.lesson_id desc limit ${limit + 1}`),
            BookmarkRow,
          )
          .pipe(Effect.orDie)
        return yield* toLessonPage(db, rows, limit, (row) => row.sort_at).pipe(Effect.orDie)
      })

      const saveProgress = Effect.fn("Engagement.saveProgress")(function* (
        id: LessonId,
        update: ProgressUpdate,
      ) {
        const user = yield* CurrentUser
        const rows = yield* db
          .query(
            raw(sql`select l.id, v.lang from lesson l
              left join lesson_version v on v.id = ${update.version_id} and v.lesson_id = l.id
              where l.id = ${id} and ${readableBy(user.id)}`),
            TargetRow,
          )
          .pipe(Effect.orDie)
        const target = rows[0]
        if (target === undefined) return yield* new LessonNotFound()
        if (target.lang === null) return yield* new VersionNotFound()
        const seen = [...new Set(update.seen)].sort()
        const state = encodeState({ lang: target.lang, last: update.last, seen, total: update.total })
        const done = seen.length >= update.total ? 1 : 0
        // The reader sends the same progress again when nothing new was seen; the `where` turns
        // that into no write at all (D1 bills rows written).
        yield* db
          .run(
            raw(sql`insert into progress (user_id, lesson_id, version_id, state, done, updated_at)
              select ${user.id}, ${id}, ${update.version_id}, ${state}, ${done}, ${Date.now()}
              where ${stillReadable(id, user.id)}
              on conflict (user_id, lesson_id) do update set version_id = excluded.version_id,
                state = excluded.state, done = excluded.done, updated_at = excluded.updated_at
              where progress.state <> excluded.state or progress.version_id <> excluded.version_id`),
          )
          .pipe(Effect.orDie)
      })

      // A range of the partial progress_user_idx (unfinished rows only), like bookmarks.
      const progress = Effect.fn("Engagement.progress")(function* (options: PageOptions) {
        const user = yield* CurrentUser
        const limit = options.limit ?? defaultPageLimit
        const rows = yield* db
          .query(
            raw(sql`select ${lessonColumns}, pr.updated_at as sort_at, pr.version_id as progress_version_id,
                pr.state as progress_state
              from progress pr
              join lesson l on l.id = pr.lesson_id
              join profile p on p.user_id = l.owner_id
              where pr.user_id = ${user.id} and pr.done = 0 and ${readableBy(user.id)}
                and ${after(sql`pr.updated_at`, sql`pr.lesson_id`, options.cursor)}
              order by pr.updated_at desc, pr.lesson_id desc limit ${limit + 1}`),
            ProgressRow,
          )
          .pipe(Effect.orDie)
        const page = yield* toLessonPage(db, rows, limit, (row) => row.sort_at).pipe(Effect.orDie)
        const items = yield* Effect.forEach(page.items, (lesson, index) => {
          const row = rows[index]
          return row === undefined
            ? Effect.die(new Error("progress page out of step with its rows"))
            : toProgress({
                version_id: row.progress_version_id,
                state: row.progress_state,
                done: 0,
                updated_at: row.sort_at,
              }).pipe(Effect.map((found) => ({ lesson, progress: found })))
        })
        const result: ProgressPage = { items, next_cursor: page.next_cursor }
        return result
      })

      return Engagement.of({
        like,
        unlike,
        bookmark,
        unbookmark,
        bookmarks,
        saveProgress,
        progress,
      })
    }),
  )
}

// The lesson delete (Lessons.remove) takes the lesson's likes, bookmarks and progress with it, in
// its own batch, and sets like_count to 0 there. Each is one range of a lesson_id index.
export const forgetLesson = (lessonId: LessonId) => [
  raw(sql`delete from lesson_like where lesson_id = ${lessonId}`),
  raw(sql`delete from bookmark where lesson_id = ${lessonId}`),
  raw(sql`delete from progress where lesson_id = ${lessonId}`),
]
