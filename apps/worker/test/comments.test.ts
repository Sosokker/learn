import { type CommentId, maxReplies, ReportId } from "@app/api"
import { assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import {
  anonymous,
  jsonBytes,
  rawFetch,
  signIn,
  signInAdmin,
  TestEnv,
  TestLayer,
  tinyLesson,
} from "./support.ts"

// Comments on @refs, reports and moderation (design §6.11). Access rules are in access.test.ts.

const publicLesson = (slug: string) =>
  Effect.gen(function* () {
    const owner = yield* signIn(`Owner ${slug}`)
    const published = yield* owner.client.lessons.publish({
      params: { slug },
      payload: jsonBytes(tinyLesson("en", slug)),
    })
    yield* owner.client.lessons.update({
      params: { id: published.lesson.id },
      payload: { visibility: "public", category_id: "math", tags: ["comments"] },
    })
    return { owner, lessonId: published.lesson.id, versionId: published.version.id }
  })

// The visible comments of a lesson, counted the slow way, to check the counter against.
const counted = (lessonId: string) =>
  Effect.gen(function* () {
    const env = yield* TestEnv
    const row = yield* Effect.promise(() =>
      env.db
        .prepare(
          `select l.comment_count as stored,
            (select count(*) from comment c where c.lesson_id = l.id and c.deleted_at is null
              and c.hidden_at is null) as actual
          from lesson l where l.id = ?`,
        )
        .bind(lessonId)
        .first<{ stored: number; actual: number }>(),
    )
    assert.isNotNull(row)
    assert.strictEqual(row?.stored, row?.actual, "comment_count")
    return row?.stored ?? -1
  })

layer(TestLayer, { excludeTestServices: true })("comments", (it) => {
  it.effect("keeps comment_count exact through replies, edits, deletes, hides and unhides", () =>
    Effect.gen(function* () {
      const { owner, lessonId, versionId } = yield* publicLesson("counted")
      const reader = yield* signIn("Counted Reader")
      const admin = yield* signInAdmin()
      const id = lessonId
      const say = (body: string, parent_id?: CommentId) =>
        reader.client.comments.create({
          params: { id },
          payload: {
            version_id: versionId,
            anchor: "part:x",
            body,
            ...(parent_id === undefined ? {} : { parent_id }),
          },
        })
      const first = yield* say("first")
      const second = yield* say("second")
      const reply = yield* say("a reply", first.id)
      assert.strictEqual(yield* counted(id), 3)
      assert.strictEqual((yield* reader.client.lessons.get({ params: { id } })).comment_count, 3)

      // Edits change no count and mark the comment edited.
      const edited = yield* reader.client.comments.update({
        params: { id, commentId: second.id },
        payload: { body: "second, better" },
      })
      assert.strictEqual(edited.body, "second, better")
      assert.isNotNull(edited.edited_at)
      assert.strictEqual(yield* counted(id), 3)

      // Delete twice: one decrement. The parent keeps its thread with no body.
      yield* reader.client.comments.delete({ params: { id, commentId: first.id } })
      yield* reader.client.comments.delete({ params: { id, commentId: first.id } })
      assert.strictEqual(yield* counted(id), 2)
      const page = yield* reader.client.comments.list({ params: { id }, query: {} })
      const thread = page.items.find((item) => item.id === first.id)
      assert.strictEqual(thread?.status, "deleted")
      assert.strictEqual(thread?.body, "")
      assert.deepStrictEqual(
        thread?.replies.map((item) => item.id),
        [reply.id],
      )
      // A deleted comment takes no edits and no replies.
      const lateEdit = yield* reader.client.comments
        .update({ params: { id, commentId: first.id }, payload: { body: "back" } })
        .pipe(Effect.flip)
      assert.strictEqual(lateEdit._tag, "CommentNotFound")
      const lateReply = yield* say("too late", first.id).pipe(Effect.flip)
      assert.strictEqual(lateReply._tag, "CommentNotFound")

      // Hide twice (owner), then hide again as admin: one decrement. The owner cannot undo the
      // admin's hide; the admin can.
      yield* owner.client.comments.hide({ params: { id, commentId: second.id } })
      yield* owner.client.comments.hide({ params: { id, commentId: second.id } })
      assert.strictEqual(yield* counted(id), 1)
      yield* admin.client.admin.hideComment({ params: { id: second.id } })
      assert.strictEqual(yield* counted(id), 1)
      const stillHidden = yield* owner.client.comments.unhide({ params: { id, commentId: second.id } })
      assert.strictEqual(stillHidden.status, "hidden")
      assert.strictEqual(stillHidden.hidden_by, "admin")
      assert.strictEqual(yield* counted(id), 1)
      yield* admin.client.admin.unhideComment({ params: { id: second.id } })
      yield* admin.client.admin.unhideComment({ params: { id: second.id } })
      assert.strictEqual(yield* counted(id), 2)
      // Hiding a deleted comment, or deleting a hidden one, never counts twice.
      yield* owner.client.comments.hide({ params: { id, commentId: reply.id } })
      assert.strictEqual(yield* counted(id), 1)
      yield* reader.client.comments.delete({ params: { id, commentId: reply.id } })
      assert.strictEqual(yield* counted(id), 1)
      yield* owner.client.comments.unhide({ params: { id, commentId: reply.id } })
      assert.strictEqual(yield* counted(id), 1)
      assert.strictEqual((yield* reader.client.lessons.get({ params: { id } })).comment_count, 1)
    }),
  )

  it.effect("keeps one level of replies, a reply cap, and the version's language", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const { owner, lessonId, versionId } = yield* publicLesson("threads")
      const id = lessonId
      const create = (payload: Record<string, string>) =>
        owner.client.comments.create({
          params: { id },
          payload: { version_id: versionId, anchor: "lesson", body: "hello", ...payload },
        })
      const top = yield* create({ anchor: "item:intro.x" })
      assert.strictEqual(top.lang, "en")
      assert.isTrue(top.is_author)
      const reply = yield* create({ parent_id: top.id })
      const nested = yield* create({ parent_id: reply.id }).pipe(Effect.flip)
      assert.strictEqual(nested._tag, "InvalidComment")
      // A version of another lesson is refused.
      const other = yield* publicLesson("threads-other")
      const wrong = yield* owner.client.comments
        .create({ params: { id }, payload: { version_id: other.versionId, anchor: "lesson", body: "x" } })
        .pipe(Effect.flip)
      assert.strictEqual(wrong._tag, "VersionNotFound")
      // Plain text within limits; anchors are target keys.
      for (const payload of [
        { body: "" },
        { body: " padded " },
        { body: "x".repeat(2001) },
        { anchor: "section:" },
        { anchor: "@threads/intro" },
        { anchor: "concept:physics.total-time" },
      ]) {
        // Raw, past the typed client (which refuses to encode these itself): the server says 400.
        const refused = yield* rawFetch(`/api/lessons/${id}/comments`, {
          method: "POST",
          headers: { cookie: owner.cookie, "content-type": "application/json" },
          body: JSON.stringify({ version_id: versionId, anchor: "lesson", body: "hello", ...payload }),
        })
        assert.strictEqual(refused.status, 400, JSON.stringify(payload).slice(0, 60))
      }
      // The cap: a full thread takes no more replies.
      yield* Effect.promise(() =>
        env.db.prepare("update comment set reply_count = ? where id = ?").bind(maxReplies, top.id).run(),
      )
      const full = yield* create({ parent_id: top.id }).pipe(Effect.flip)
      assert.strictEqual(full._tag, "InvalidComment")
    }),
  )

  it.effect("lists threads newest first by keyset pages, for one anchor or all", () =>
    Effect.gen(function* () {
      const { owner, lessonId, versionId } = yield* publicLesson("paged")
      const anon = yield* anonymous()
      const id = lessonId
      const made: Array<string> = []
      for (const [index, anchor] of [
        "section:intro",
        "part:x",
        "section:intro",
        "lesson",
        "section:intro",
      ].entries()) {
        const comment = yield* owner.client.comments.create({
          params: { id },
          payload: { version_id: versionId, anchor, body: `comment ${index}` },
        })
        made.push(comment.id)
      }
      const newestFirst = made.toReversed()
      const page1 = yield* anon.comments.list({ params: { id }, query: { limit: 2 } })
      assert.deepStrictEqual(
        page1.items.map((item) => item.id),
        newestFirst.slice(0, 2),
      )
      assert.isNotNull(page1.next_cursor)
      const cursor = page1.next_cursor ?? undefined
      const page2 = yield* anon.comments.list({
        params: { id },
        query: cursor === undefined ? { limit: 2 } : { limit: 2, cursor },
      })
      assert.deepStrictEqual(
        page2.items.map((item) => item.id),
        newestFirst.slice(2, 4),
      )
      const intro = yield* anon.comments.list({ params: { id }, query: { anchor: "section:intro" } })
      assert.deepStrictEqual(
        intro.items.map((item) => item.id),
        [made[4], made[2], made[0]],
      )
      assert.isNull(intro.next_cursor)
      assert.isFalse(intro.items.some((item) => item.is_author))
    }),
  )

  it.effect("takes reports once per user and target, and resolves a target's reports together", () =>
    Effect.gen(function* () {
      const { owner, lessonId, versionId } = yield* publicLesson("reported")
      const admin = yield* signInAdmin()
      const one = yield* signIn("Reporter One")
      const two = yield* signIn("Reporter Two")
      const comment = yield* owner.client.comments.create({
        params: { id: lessonId },
        payload: { version_id: versionId, anchor: "lesson", body: "buy cheap pills" },
      })
      const queue = () => admin.client.admin.reports({ query: {} })
      const before = (yield* queue()).items.length
      for (const reporter of [one, two, one, two]) {
        yield* reporter.client.reports.create({
          payload: { target_type: "comment", target_id: comment.id, reason: "spam", note: "ads" },
        })
      }
      yield* one.client.reports.create({
        payload: { target_type: "lesson", target_id: lessonId, reason: "wrong" },
      })
      const open = (yield* queue()).items
      assert.strictEqual(open.length, before + 3)
      const onComment = open.filter((item) => item.target_id === comment.id)
      assert.strictEqual(onComment.length, 2)
      assert.strictEqual(onComment[0]?.comment?.body, "buy cheap pills")
      assert.strictEqual(onComment[0]?.lesson?.id, lessonId)
      assert.strictEqual(onComment[0]?.note, "ads")
      const onLesson = open.find((item) => item.target_type === "lesson")
      assert.strictEqual(onLesson?.lesson?.slug, "reported")
      assert.isNull(onLesson?.comment)

      // Keyset pages over the queue.
      const first = yield* admin.client.admin.reports({ query: { limit: 1 } })
      assert.strictEqual(first.items.length, 1)
      const cursor = first.next_cursor ?? undefined
      assert.isDefined(cursor)
      if (cursor !== undefined) {
        const second = yield* admin.client.admin.reports({ query: { limit: 1, cursor } })
        assert.notStrictEqual(second.items[0]?.id, first.items[0]?.id)
      }

      // Hide, then resolve one report: both reports of the comment close.
      yield* admin.client.admin.hideComment({ params: { id: comment.id } })
      const target = onComment[0]
      if (target !== undefined) {
        yield* admin.client.admin.resolve({ params: { id: target.id }, payload: { status: "resolved" } })
        yield* admin.client.admin.resolve({ params: { id: target.id }, payload: { status: "dismissed" } })
      }
      const after = (yield* queue()).items
      assert.isFalse(after.some((item) => item.target_id === comment.id))
      assert.isTrue(after.some((item) => item.target_type === "lesson" && item.target_id === lessonId))
      // Once visible again, a new report opens a new entry.
      yield* admin.client.admin.unhideComment({ params: { id: comment.id } })
      yield* two.client.reports.create({
        payload: { target_type: "comment", target_id: comment.id, reason: "abuse" },
      })
      assert.isTrue((yield* queue()).items.some((item) => item.target_id === comment.id))

      const unknown = yield* admin.client.admin
        .resolve({ params: { id: ReportId.make(comment.id) }, payload: { status: "resolved" } })
        .pipe(Effect.flip)
      assert.strictEqual(unknown._tag, "ReportNotFound")
    }),
  )
})
