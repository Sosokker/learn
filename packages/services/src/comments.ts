import {
  type Comment,
  CommentAnchor,
  type CommentCreate,
  CommentHiddenBy,
  CommentId,
  CommentNotFound,
  type CommentPage,
  type CommentThread,
  CurrentAdmin,
  CurrentUser,
  defaultPageLimit,
  type FeedCursor,
  Handle,
  InvalidComment,
  LessonId,
  LessonNotFound,
  LessonVersionId,
  Millis,
  maxReplies,
  UserId,
  VersionNotFound,
} from "@app/api"
import { Database, raw, uuidv7 } from "@app/db"
import { LessonLang } from "@app/domain"
import { type SQL, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Admins } from "./admins.ts"
import { after, inList, readableBy, stillReadable } from "./rows.ts"

export interface CommentListOptions {
  readonly cursor?: FeedCursor | undefined
  readonly limit?: number | undefined
  readonly anchor?: CommentAnchor | undefined
}

// The comment list of one lesson. Like LessonReads: `never` for anonymous readers, `CurrentUser`
// for signed-in ones, who also see the comments of their own private lessons.
export interface CommentReads<R> {
  readonly list: (id: LessonId, options: CommentListOptions) => Effect.Effect<CommentPage, LessonNotFound, R>
}

const CommentRow = Schema.Struct({
  id: CommentId,
  lesson_id: LessonId,
  parent_id: Schema.NullOr(CommentId),
  anchor: CommentAnchor,
  version_id: LessonVersionId,
  lang: LessonLang,
  user_id: UserId,
  author_handle: Schema.NullOr(Handle),
  body: Schema.String,
  reply_count: Schema.Int,
  created_at: Millis,
  edited_at: Schema.NullOr(Millis),
  deleted_at: Schema.NullOr(Millis),
  hidden_at: Schema.NullOr(Millis),
  hidden_by: Schema.NullOr(CommentHiddenBy),
})
type CommentRow = typeof CommentRow.Type

const commentSelect = sql`select c.id, c.lesson_id, c.parent_id, c.anchor, c.version_id, v.lang, c.user_id,
  p.handle as author_handle, c.body, c.reply_count, c.created_at, c.edited_at, c.deleted_at, c.hidden_at,
  c.hidden_by
  from comment c
  join lesson_version v on v.id = c.version_id
  left join profile p on p.user_id = c.user_id`

const LessonOwnerRow = Schema.Struct({ id: LessonId, owner_id: UserId })
const ParentRow = Schema.Struct({
  parent_id: Schema.NullOr(CommentId),
  anchor: CommentAnchor,
  user_id: UserId,
  reply_count: Schema.Int,
  deleted_at: Schema.NullOr(Millis),
  hidden_at: Schema.NullOr(Millis),
})
const VersionRow = Schema.Struct({ id: LessonVersionId })
const IdRow = Schema.Struct({ id: Schema.String })
const LessonIdRow = Schema.Struct({ lesson_id: LessonId })

// Who sees a hidden comment: its author, and the moderators of the lesson (its owner and admins
// signed in with a session cookie; see Admins).
type Seer = { readonly viewer: UserId | undefined; readonly moderator: boolean }
type Reader = CurrentUser["Service"] | undefined

// Rows the viewer sees with their body: not deleted, and not hidden unless they may see it.
const seeable = (seer: Seer): SQL => {
  if (seer.moderator) return sql`c.deleted_at is null`
  if (seer.viewer === undefined) return sql`c.deleted_at is null and c.hidden_at is null`
  return sql`c.deleted_at is null and (c.hidden_at is null or c.user_id = ${seer.viewer})`
}

const toComment = (row: CommentRow, seer: Seer): Comment => {
  const mayRead = row.hidden_at === null || seer.moderator || row.user_id === seer.viewer
  const status =
    row.deleted_at !== null ? "deleted" : row.hidden_at === null ? "visible" : mayRead ? "hidden" : "removed"
  const shown = status === "visible" || status === "hidden"
  return {
    id: row.id,
    lesson_id: row.lesson_id,
    parent_id: row.parent_id,
    anchor: row.anchor,
    version_id: row.version_id,
    lang: row.lang,
    author_handle: shown ? row.author_handle : null,
    body: shown ? row.body : "",
    status,
    hidden_by: status === "hidden" ? row.hidden_by : null,
    is_author: seer.viewer !== undefined && row.user_id === seer.viewer,
    reply_count: row.reply_count,
    created_at: row.created_at,
    edited_at: shown ? row.edited_at : null,
  }
}

// `lesson.comment_count` counts visible comments (not deleted, not hidden). Every change moves
// it in the same batch as the comment, guarded by the comment's state just before the change, so a
// repeated delete, hide or unhide moves nothing and the count stays exact without counting.
const countIf = (lessonId: LessonId, sign: 1 | -1, condition: SQL) =>
  raw(sql`update lesson set comment_count = comment_count + ${sign}
    where id = ${lessonId} and exists (select 1 from comment c where ${condition})`)
const isVisible = (commentId: string) =>
  sql`c.id = ${commentId} and c.deleted_at is null and c.hidden_at is null`

export class Comments extends Context.Service<
  Comments,
  {
    readonly anonymous: CommentReads<never>
    readonly asUser: CommentReads<CurrentUser>
    readonly create: (
      id: LessonId,
      input: CommentCreate,
    ) => Effect.Effect<
      Comment,
      LessonNotFound | VersionNotFound | CommentNotFound | InvalidComment,
      CurrentUser
    >
    // The author's own comment only.
    readonly edit: (
      id: LessonId,
      commentId: CommentId,
      body: string,
    ) => Effect.Effect<Comment, LessonNotFound | CommentNotFound, CurrentUser>
    readonly remove: (
      id: LessonId,
      commentId: CommentId,
    ) => Effect.Effect<void, LessonNotFound | CommentNotFound, CurrentUser>
    // The lesson owner's moderation.
    readonly hide: (
      id: LessonId,
      commentId: CommentId,
    ) => Effect.Effect<Comment, LessonNotFound | CommentNotFound, CurrentUser>
    readonly unhide: (
      id: LessonId,
      commentId: CommentId,
    ) => Effect.Effect<Comment, LessonNotFound | CommentNotFound, CurrentUser>
    // An admin's: any comment, on any lesson. An admin's hide is undone only by an admin.
    readonly adminHide: (commentId: CommentId) => Effect.Effect<void, CommentNotFound, CurrentAdmin>
    readonly adminUnhide: (commentId: CommentId) => Effect.Effect<void, CommentNotFound, CurrentAdmin>
  }
>()("@app/services/Comments") {
  static readonly layer = Layer.effect(
    Comments,
    Effect.gen(function* () {
      const db = yield* Database
      const admins = yield* Admins

      // The lesson, if the viewer can read it (public, unlisted, or their own), else the 404.
      const readableLesson = Effect.fn("Comments.readableLesson")(function* (
        id: LessonId,
        viewer: UserId | undefined,
      ) {
        const rows = yield* db
          .query(
            raw(sql`select l.id, l.owner_id from lesson l where l.id = ${id} and ${readableBy(viewer)}`),
            LessonOwnerRow,
          )
          .pipe(Effect.orDie)
        const lesson = rows[0]
        if (lesson === undefined) return yield* new LessonNotFound()
        return lesson
      })

      const seerOf = (lesson: typeof LessonOwnerRow.Type, reader: Reader): Seer => ({
        viewer: reader?.id,
        moderator: reader !== undefined && (reader.id === lesson.owner_id || admins.isAdmin(reader)),
      })

      const one = Effect.fn("Comments.one")(function* (commentId: CommentId, seer: Seer) {
        const rows = yield* db
          .query(raw(sql`${commentSelect} where c.id = ${commentId}`), CommentRow)
          .pipe(Effect.orDie)
        const row = rows[0]
        if (row === undefined) return yield* Effect.die(new Error(`comment ${commentId} vanished`))
        return toComment(row, seer)
      })

      // A page of threads: one range of comment_thread_idx (or comment_anchor_idx), then the replies
      // of the page's threads from comment_reply_idx. A deleted or removed thread is kept only
      // while it has replies to show.
      const reads = <R>(readerOf: Effect.Effect<Reader, never, R>): CommentReads<R> => ({
        list: Effect.fn("Comments.list")(function* (id: LessonId, options: CommentListOptions) {
          const reader = yield* readerOf
          const lesson = yield* readableLesson(id, reader?.id)
          const seer = seerOf(lesson, reader)
          const limit = options.limit ?? defaultPageLimit
          const rows = yield* db
            .query(
              raw(sql`${commentSelect}
                where c.lesson_id = ${id} and c.parent_id is null
                  ${options.anchor === undefined ? sql`` : sql`and c.anchor = ${options.anchor}`}
                  and (${seeable(seer)} or c.reply_count > 0)
                  and ${after(sql`c.created_at`, sql`c.id`, options.cursor)}
                order by c.created_at desc, c.id desc limit ${limit + 1}`),
              CommentRow,
            )
            .pipe(Effect.orDie)
          const threads = rows.slice(0, limit)
          const replies =
            threads.length === 0
              ? []
              : yield* db
                  .query(
                    raw(sql`${commentSelect}
                      where c.parent_id in ${inList(threads.map((row) => row.id))} and c.parent_id is not null
                        and ${seeable(seer)}`),
                    CommentRow,
                  )
                  .pipe(Effect.orDie)
          const ordered = replies.toSorted((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
          const items = threads.flatMap((row): ReadonlyArray<CommentThread> => {
            const thread: CommentThread = {
              ...toComment(row, seer),
              replies: ordered
                .filter((reply) => reply.parent_id === row.id)
                .map((reply) => toComment(reply, seer)),
            }
            const empty =
              thread.status !== "visible" && thread.status !== "hidden" && thread.replies.length === 0
            return empty ? [] : [thread]
          })
          const last = threads.at(-1)
          const page: CommentPage = {
            items,
            next_cursor:
              rows.length > limit && last !== undefined ? { at: last.created_at, id: last.id } : null,
          }
          return page
        }),
      })

      const anonymous = reads(Effect.succeed(undefined))
      const asUser = reads(Effect.service(CurrentUser).pipe(Effect.map((user): Reader => user)))

      // The comment a reply goes under: top-level, seen by the replier, not hidden, not full.
      const replyable = Effect.fn("Comments.replyable")(function* (
        id: LessonId,
        parentId: CommentId,
        seer: Seer,
      ) {
        const parents = yield* db
          .query(
            raw(sql`select c.parent_id, c.anchor, c.user_id, c.reply_count, c.deleted_at, c.hidden_at from comment c
              where c.id = ${parentId} and c.lesson_id = ${id} and ${seeable(seer)}`),
            ParentRow,
          )
          .pipe(Effect.orDie)
        const parent = parents[0]
        if (parent === undefined) return yield* new CommentNotFound()
        if (parent.parent_id !== null)
          return yield* new InvalidComment({ message: "reply to a top-level comment" })
        if (parent.hidden_at !== null) return yield* new InvalidComment({ message: "this comment is hidden" })
        if (parent.reply_count >= maxReplies)
          return yield* new InvalidComment({ message: `a thread takes at most ${maxReplies} replies` })
        return parent
      })

      const create = Effect.fn("Comments.create")(function* (id: LessonId, input: CommentCreate) {
        const user = yield* CurrentUser
        const lesson = yield* readableLesson(id, user.id)
        const seer = seerOf(lesson, user)
        const versions = yield* db
          .query(
            raw(sql`select id from lesson_version where id = ${input.version_id} and lesson_id = ${id}`),
            VersionRow,
          )
          .pipe(Effect.orDie)
        if (versions.length === 0) return yield* new VersionNotFound()

        const parent = input.parent_id === undefined ? undefined : yield* replyable(id, input.parent_id, seer)
        const parentId = input.parent_id ?? null
        const anchor = parent?.anchor ?? input.anchor

        const now = Date.now()
        const commentId = CommentId.make(uuidv7(now))
        // The parent is checked again inside the batch (one transaction), so a racing reply cannot
        // pass the cap or land under a comment deleted or hidden meanwhile.
        const parentOk =
          parentId === null
            ? sql`1 = 1`
            : sql`exists (select 1 from comment where id = ${parentId} and reply_count < ${maxReplies}
                and deleted_at is null and hidden_at is null)`
        const inserted = sql`exists (select 1 from comment where id = ${commentId})`
        // The lesson is checked again in the batch too: one deleted or made private since the check
        // above gets no comment, and the counters below move only when the comment went in.
        yield* db
          .batch([
            raw(sql`insert into comment (id, lesson_id, user_id, version_id, anchor, parent_id, body, reply_count, created_at)
              select ${commentId}, ${id}, ${user.id}, ${input.version_id}, ${anchor}, ${parentId}, ${input.body}, 0, ${now}
              where ${parentOk} and ${stillReadable(id, user.id)}`),
            ...(parentId === null
              ? []
              : [
                  raw(
                    sql`update comment set reply_count = reply_count + 1 where id = ${parentId} and ${inserted}`,
                  ),
                ]),
            raw(sql`update lesson set comment_count = comment_count + 1 where id = ${id} and ${inserted}`),
          ])
          .pipe(Effect.orDie)
        const written = yield* db
          .query(raw(sql`select id from comment where id = ${commentId}`), IdRow)
          .pipe(Effect.orDie)
        if (written.length === 0) {
          yield* readableLesson(id, user.id)
          return yield* new InvalidComment({ message: "the comment you reply to changed" })
        }
        return yield* one(commentId, seer)
      })

      const edit = Effect.fn("Comments.edit")(function* (id: LessonId, commentId: CommentId, body: string) {
        const user = yield* CurrentUser
        const lesson = yield* readableLesson(id, user.id)
        const updated = yield* db
          .query(
            raw(sql`update comment set body = ${body}, edited_at = ${Date.now()}
              where id = ${commentId} and lesson_id = ${id} and user_id = ${user.id} and deleted_at is null
              returning id`),
            IdRow,
          )
          .pipe(Effect.orDie)
        if (updated.length === 0) return yield* new CommentNotFound()
        return yield* one(commentId, seerOf(lesson, user))
      })

      // Soft: the body goes, the row stays, so the replies keep their thread. A second delete
      // changes nothing.
      const remove = Effect.fn("Comments.remove")(function* (id: LessonId, commentId: CommentId) {
        const user = yield* CurrentUser
        yield* readableLesson(id, user.id)
        const own = yield* db
          .query(
            raw(
              sql`select id from comment where id = ${commentId} and lesson_id = ${id} and user_id = ${user.id}`,
            ),
            IdRow,
          )
          .pipe(Effect.orDie)
        if (own.length === 0) return yield* new CommentNotFound()
        yield* db
          .batch([
            countIf(id, -1, isVisible(commentId)),
            raw(sql`update comment set deleted_at = ${Date.now()}, body = '', edited_at = null
              where id = ${commentId} and deleted_at is null`),
          ])
          .pipe(Effect.orDie)
      })

      const hideBatch = (lessonId: LessonId, commentId: CommentId, by: CommentHiddenBy) => [
        countIf(lessonId, -1, isVisible(commentId)),
        // An admin's hide also takes over an owner's, so the owner cannot undo it.
        by === "admin"
          ? raw(sql`update comment set hidden_at = coalesce(hidden_at, ${Date.now()}), hidden_by = 'admin'
              where id = ${commentId}`)
          : raw(sql`update comment set hidden_at = ${Date.now()}, hidden_by = 'owner'
              where id = ${commentId} and hidden_at is null`),
      ]

      const unhideBatch = (lessonId: LessonId, commentId: CommentId, by: CommentHiddenBy) => {
        const undoable = (alias: SQL) => (by === "admin" ? sql`1 = 1` : sql`${alias}.hidden_by = 'owner'`)
        return [
          countIf(
            lessonId,
            1,
            sql`c.id = ${commentId} and c.deleted_at is null and c.hidden_at is not null and ${undoable(sql`c`)}`,
          ),
          raw(sql`update comment set hidden_at = null, hidden_by = null
            where id = ${commentId} and hidden_at is not null and ${undoable(sql`comment`)}`),
        ]
      }

      // The owner of the lesson, on a comment of that lesson. Anyone else: the 404.
      const moderated = Effect.fn("Comments.moderated")(function* (id: LessonId, commentId: CommentId) {
        const user = yield* CurrentUser
        const lesson = yield* readableLesson(id, user.id)
        if (lesson.owner_id !== user.id) return yield* new CommentNotFound()
        const found = yield* db
          .query(raw(sql`select id from comment where id = ${commentId} and lesson_id = ${id}`), IdRow)
          .pipe(Effect.orDie)
        if (found.length === 0) return yield* new CommentNotFound()
        return seerOf(lesson, user)
      })

      const hide = Effect.fn("Comments.hide")(function* (id: LessonId, commentId: CommentId) {
        const seer = yield* moderated(id, commentId)
        yield* db.batch(hideBatch(id, commentId, "owner")).pipe(Effect.orDie)
        return yield* one(commentId, seer)
      })

      const unhide = Effect.fn("Comments.unhide")(function* (id: LessonId, commentId: CommentId) {
        const seer = yield* moderated(id, commentId)
        yield* db.batch(unhideBatch(id, commentId, "owner")).pipe(Effect.orDie)
        return yield* one(commentId, seer)
      })

      const lessonOf = Effect.fn("Comments.lessonOf")(function* (commentId: CommentId) {
        yield* CurrentAdmin
        const rows = yield* db
          .query(raw(sql`select lesson_id from comment where id = ${commentId}`), LessonIdRow)
          .pipe(Effect.orDie)
        const row = rows[0]
        if (row === undefined) return yield* new CommentNotFound()
        return row.lesson_id
      })

      const adminHide = Effect.fn("Comments.adminHide")(function* (commentId: CommentId) {
        const lessonId = yield* lessonOf(commentId)
        yield* db.batch(hideBatch(lessonId, commentId, "admin")).pipe(Effect.orDie)
      })

      const adminUnhide = Effect.fn("Comments.adminUnhide")(function* (commentId: CommentId) {
        const lessonId = yield* lessonOf(commentId)
        yield* db.batch(unhideBatch(lessonId, commentId, "admin")).pipe(Effect.orDie)
      })

      return Comments.of({ anonymous, asUser, create, edit, remove, hide, unhide, adminHide, adminUnhide })
    }),
  )
}
