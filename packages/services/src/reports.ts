import {
  type AdminReport,
  CommentAnchor,
  CommentHiddenBy,
  CommentId,
  CommentNotFound,
  CurrentAdmin,
  CurrentUser,
  defaultPageLimit,
  Handle,
  LessonId,
  LessonNotFound,
  Millis,
  type ReportCreate,
  ReportId,
  ReportNotFound,
  type ReportPage,
  ReportReason,
  type ReportResolve,
  ReportTargetType,
  Visibility,
} from "@app/api"
import { Database, raw, uuidv7 } from "@app/db"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import type { PageOptions } from "./feeds.ts"
import { after, readableBy } from "./rows.ts"

const IdRow = Schema.Struct({ id: Schema.String })
const TargetRow = Schema.Struct({
  target_type: ReportTargetType,
  target_id: Schema.String,
  status: Schema.String,
})

const QueueRow = Schema.Struct({
  id: ReportId,
  target_type: ReportTargetType,
  target_id: Schema.String,
  reason: ReportReason,
  note: Schema.NullOr(Schema.String),
  created_at: Millis,
  reporter_handle: Schema.NullOr(Handle),
  comment_id: Schema.NullOr(CommentId),
  comment_anchor: Schema.NullOr(CommentAnchor),
  comment_author: Schema.NullOr(Handle),
  comment_body: Schema.NullOr(Schema.String),
  comment_hidden_by: Schema.NullOr(CommentHiddenBy),
  comment_deleted_at: Schema.NullOr(Millis),
  lesson_id: Schema.NullOr(LessonId),
  lesson_owner_handle: Schema.NullOr(Handle),
  lesson_slug: Schema.NullOr(Schema.String),
  lesson_title: Schema.NullOr(Schema.String),
  lesson_visibility: Schema.NullOr(Visibility),
  lesson_deleted_at: Schema.NullOr(Millis),
})
type QueueRow = typeof QueueRow.Type

const toReport = (row: QueueRow): AdminReport => ({
  id: row.id,
  target_type: row.target_type,
  target_id: row.target_id,
  reason: row.reason,
  note: row.note,
  reporter_handle: row.reporter_handle,
  created_at: row.created_at,
  lesson:
    row.lesson_id === null ||
    row.lesson_owner_handle === null ||
    row.lesson_slug === null ||
    row.lesson_title === null ||
    row.lesson_visibility === null
      ? null
      : {
          id: row.lesson_id,
          owner_handle: row.lesson_owner_handle,
          slug: row.lesson_slug,
          title: row.lesson_title,
          visibility: row.lesson_visibility,
          deleted: row.lesson_deleted_at !== null,
        },
  comment:
    row.comment_id === null || row.comment_anchor === null
      ? null
      : {
          id: row.comment_id,
          anchor: row.comment_anchor,
          author_handle: row.comment_author,
          body: row.comment_body ?? "",
          hidden_by: row.comment_hidden_by,
          deleted: row.comment_deleted_at !== null,
        },
})

// Reports of lessons and comments. Anyone signed in reports what they can see; only admins (the
// CurrentAdmin requirement, provided by the Admin middleware alone) list and resolve them.
export class Reports extends Context.Service<
  Reports,
  {
    readonly create: (
      input: ReportCreate,
    ) => Effect.Effect<void, LessonNotFound | CommentNotFound, CurrentUser>
    readonly queue: (options: PageOptions) => Effect.Effect<ReportPage, never, CurrentAdmin>
    readonly resolve: (
      id: ReportId,
      input: ReportResolve,
    ) => Effect.Effect<void, ReportNotFound, CurrentAdmin>
  }
>()("@app/services/Reports") {
  static readonly layer = Layer.effect(
    Reports,
    Effect.gen(function* () {
      const db = yield* Database

      const create = Effect.fn("Reports.create")(function* (input: ReportCreate) {
        const user = yield* CurrentUser
        // The target must be one the reporter can see, with the same 404 as reading it, so a report
        // cannot probe for private lessons or hidden comments.
        if (input.target_type === "lesson") {
          const found = yield* db
            .query(
              raw(sql`select l.id from lesson l where l.id = ${input.target_id} and ${readableBy(user.id)}`),
              IdRow,
            )
            .pipe(Effect.orDie)
          if (found.length === 0) return yield* new LessonNotFound()
        } else {
          const found = yield* db
            .query(
              raw(sql`select c.id from comment c join lesson l on l.id = c.lesson_id
                where c.id = ${input.target_id} and ${readableBy(user.id)} and c.deleted_at is null
                  and (c.hidden_at is null or c.user_id = ${user.id} or l.owner_id = ${user.id})`),
              IdRow,
            )
            .pipe(Effect.orDie)
          if (found.length === 0) return yield* new CommentNotFound()
        }
        // One open report per reporter and target (report_open_unique): a repeat writes nothing.
        yield* db
          .run(
            raw(sql`insert into report (id, target_type, target_id, reporter_id, reason, note, status, created_at)
              values (${uuidv7()}, ${input.target_type}, ${input.target_id}, ${user.id}, ${input.reason},
                ${input.note === undefined || input.note === "" ? null : input.note}, 'open', ${Date.now()})
              on conflict (reporter_id, target_type, target_id) where status = 'open' do nothing`),
          )
          .pipe(Effect.orDie)
      })

      // A range of the partial report_queue_idx (open reports only), each joined by primary key to
      // its reporter, comment and lesson.
      const queue = Effect.fn("Reports.queue")(function* (options: PageOptions) {
        yield* CurrentAdmin
        const limit = options.limit ?? defaultPageLimit
        const rows = yield* db
          .query(
            raw(sql`select r.id, r.target_type, r.target_id, r.reason, r.note, r.created_at,
                rp.handle as reporter_handle,
                c.id as comment_id, c.anchor as comment_anchor, cp.handle as comment_author,
                c.body as comment_body, c.hidden_by as comment_hidden_by, c.deleted_at as comment_deleted_at,
                l.id as lesson_id, lp.handle as lesson_owner_handle, l.slug as lesson_slug, l.title as lesson_title,
                l.visibility as lesson_visibility, l.deleted_at as lesson_deleted_at
              from report r
              left join profile rp on rp.user_id = r.reporter_id
              left join comment c on r.target_type = 'comment' and c.id = r.target_id
              left join profile cp on cp.user_id = c.user_id
              left join lesson l on l.id = (case when r.target_type = 'lesson' then r.target_id else c.lesson_id end)
              left join profile lp on lp.user_id = l.owner_id
              where r.status = 'open' and ${after(sql`r.created_at`, sql`r.id`, options.cursor)}
              order by r.created_at desc, r.id desc limit ${limit + 1}`),
            QueueRow,
          )
          .pipe(Effect.orDie)
        const items = rows.slice(0, limit)
        const last = items.at(-1)
        const page: ReportPage = {
          items: items.map(toReport),
          next_cursor:
            rows.length > limit && last !== undefined ? { at: last.created_at, id: last.id } : null,
        }
        return page
      })

      // Closes every open report of the report's target (report_target_idx), so one decision
      // clears the duplicates from other reporters. A closed report changes nothing.
      const resolve = Effect.fn("Reports.resolve")(function* (id: ReportId, input: ReportResolve) {
        const admin = yield* CurrentAdmin
        const rows = yield* db
          .query(raw(sql`select target_type, target_id, status from report where id = ${id}`), TargetRow)
          .pipe(Effect.orDie)
        const target = rows[0]
        if (target === undefined) return yield* new ReportNotFound()
        if (target.status !== "open") return
        yield* db
          .run(
            raw(sql`update report set status = ${input.status}, resolved_at = ${Date.now()}, resolved_by = ${admin.id}
              where target_type = ${target.target_type} and target_id = ${target.target_id} and status = 'open'`),
          )
          .pipe(Effect.orDie)
      })

      return Reports.of({ create, queue, resolve })
    }),
  )
}
