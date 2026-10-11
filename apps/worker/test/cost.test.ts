import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  type CommentId,
  CurrentAdmin,
  CurrentUser,
  type FeedCursor,
  type LessonId,
  LessonId as LessonIdSchema,
  UserId,
} from "@app/api"
import { type Compilable, D1, Database } from "@app/db"
import {
  Comments,
  Concepts,
  Engagement,
  Feeds,
  HotScore,
  LessonSearch,
  Lessons,
  Reports,
} from "@app/services"
import { assert, layer } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import { StorageR2 } from "../src/storage-r2.ts"
import { handleFetch, securityHeaders } from "../src/worker.ts"
import {
  adminUserId,
  anonymous,
  jsonBytes,
  readContent,
  signIn,
  signInAdmin,
  TestEnv,
  TestLayer,
  tinyLesson,
} from "./support.ts"

// D1 bills rows scanned. These tests run the services' real SQL (recorded through a Database
// layer that keeps every statement) under EXPLAIN QUERY PLAN on the migrated D1, and check that
// the counters the feeds show stay exact without counting.

type Recorded = { readonly sql: string; readonly params: ReadonlyArray<unknown> }

const recordingDatabase = (d1: D1Database, recorded: Array<Recorded>) =>
  Layer.effect(
    Database,
    Effect.gen(function* () {
      const inner = yield* Database
      const record = (statement: Compilable) => Effect.sync(() => void recorded.push(statement.toSQL()))
      return Database.of({
        ...inner,
        query: <S extends Schema.Decoder<unknown>>(statement: Compilable, row: S) =>
          record(statement).pipe(Effect.andThen(inner.query(statement, row))),
        run: (statement) => record(statement).pipe(Effect.andThen(inner.run(statement))),
        batch: (statements) =>
          Effect.forEach(statements, record).pipe(Effect.andThen(inner.batch(statements))),
      })
    }),
  ).pipe(Layer.provide(Database.layer), Layer.provide(Layer.succeed(D1, d1)))

const plan = (d1: D1Database, statement: Recorded) =>
  Effect.promise(() =>
    d1
      .prepare(`explain query plan ${statement.sql}`)
      .bind(...statement.params)
      .all<{ detail: string }>(),
  ).pipe(Effect.map((result) => result.results.map((row) => row.detail)))

// A full scan of a table or index, a sort in a temp b-tree, or an FTS5 lookup with no constraint
// (`INDEX 0:` with nothing after the colon reads every FTS row). `SCAN CONSTANT ROW` is the one
// row of an `insert … select … where`, not a table.
const costly = (detail: string) =>
  /^SCAN (?!.*VIRTUAL TABLE)(?!CONSTANT ROW)/.test(detail) ||
  detail.includes("TEMP B-TREE") ||
  /VIRTUAL TABLE INDEX \d+:$/.test(detail)

const tagCounts = (d1: D1Database) =>
  Effect.promise(() =>
    d1
      .prepare("select slug, lesson_count from tag order by slug")
      .all<{ slug: string; lesson_count: number }>(),
  ).pipe(
    Effect.map((result) => Object.fromEntries(result.results.map((row) => [row.slug, row.lesson_count]))),
  )

layer(TestLayer, { excludeTestServices: true })("cost and headers", (it) => {
  it.effect("lists a parent category's feed from one index range, without a sort", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const author = yield* signIn("Category Author")
      const anon = yield* anonymous()
      const publish = (slug: string, category_id: string) =>
        Effect.gen(function* () {
          const published = yield* author.client.lessons.publish({
            params: { slug },
            payload: jsonBytes(tinyLesson("en", slug)),
          })
          yield* author.client.lessons.update({
            params: { id: published.lesson.id },
            payload: { visibility: "public", category_id, tags: ["categories"] },
          })
          return published.lesson.id
        })
      const deep = yield* publish("deep", "math.analysis.real-analysis")
      const algebra = yield* publish("algebra", "math.algebra")
      const top = yield* publish("top", "math")
      const physics = yield* publish("physics", "physics.mechanics")

      const feed = (id: string, cursor: FeedCursor | null = null) =>
        anon.feeds.category({ params: { id }, query: cursor === null ? { limit: 2 } : { limit: 2, cursor } })
      const ids = (id: string) =>
        anon.feeds
          .category({ params: { id }, query: {} })
          .pipe(Effect.map((page) => page.items.map((item) => item.id)))

      // A lesson lists under its category and every ancestor; newest first.
      assert.deepStrictEqual(yield* ids("math"), [top, algebra, deep])
      assert.deepStrictEqual(yield* ids("math.analysis"), [deep])
      assert.deepStrictEqual(yield* ids("math.analysis.real-analysis"), [deep])
      assert.deepStrictEqual(yield* ids("physics"), [physics])
      // Keyset pages over a parent.
      const page1 = yield* feed("math")
      assert.deepStrictEqual(
        page1.items.map((item) => item.id),
        [top, algebra],
      )
      assert.isNotNull(page1.next_cursor)
      const page2 = yield* feed("math", page1.next_cursor)
      assert.deepStrictEqual(
        page2.items.map((item) => item.id),
        [deep],
      )
      assert.isNull(page2.next_cursor)

      // Moving, hiding and deleting take it out of the old feeds.
      yield* author.client.lessons.update({ params: { id: deep }, payload: { category_id: "physics.waves" } })
      assert.deepStrictEqual(yield* ids("math.analysis"), [])
      // It keeps its first-public time, so it stays older than `physics`.
      assert.deepStrictEqual(yield* ids("physics"), [physics, deep])
      yield* author.client.lessons.update({ params: { id: deep }, payload: { visibility: "unlisted" } })
      assert.deepStrictEqual(yield* ids("physics"), [physics])
      yield* author.client.lessons.delete({ params: { id: physics } })
      assert.deepStrictEqual(yield* ids("physics"), [])

      // The plan of the feed query, parent category and a later page.
      const recorded: Array<Recorded> = []
      const recorder = Layer.fresh(Feeds.layer).pipe(Layer.provide(recordingDatabase(env.db, recorded)))
      yield* Feeds.use((feeds) =>
        Effect.gen(function* () {
          yield* feeds.category("math", {})
          yield* feeds.category("math", { cursor: { at: Date.now(), id: top }, limit: 2 })
        }),
      ).pipe(Effect.provide(recorder))
      const feedQueries = recorded.filter((statement) => statement.sql.includes("lesson_category"))
      assert.strictEqual(feedQueries.length, 2)
      for (const statement of feedQueries) {
        const details = yield* plan(env.db, statement)
        assert.isTrue(
          details.some((detail) => detail.includes("lesson_category_feed_idx")),
          details.join("\n"),
        )
        assert.isFalse(details.some(costly), details.join("\n"))
      }
    }),
  )

  it.effect("reads the hot feed and the kind and language filters from one index range each", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const recorded: Array<Recorded> = []
      const recorder = Layer.fresh(Feeds.layer).pipe(Layer.provide(recordingDatabase(env.db, recorded)))
      const cursor = { at: 0.5, id: "01900000-0000-7000-8000-000000000000" }
      const expected: Array<string> = []
      const run = <A, E>(index: string, feed: (feeds: Feeds["Service"]) => Effect.Effect<A, E>) =>
        Feeds.use((feeds) =>
          Effect.gen(function* () {
            expected.push(index, index)
            yield* feed(feeds).pipe(Effect.ignore)
          }),
        ).pipe(Effect.provide(recorder))
      // Each feed twice: the first page and a later one (keyset cursor).
      yield* run("lesson_hot_idx", (feeds) => Effect.all([feeds.hot({}), feeds.hot({ cursor, limit: 2 })]))
      yield* run("lesson_kind_hot_idx", (feeds) =>
        Effect.all([feeds.hot({ kind: "learn" }), feeds.hot({ kind: "learn", cursor })]),
      )
      yield* run("lesson_kind_idx", (feeds) =>
        Effect.all([feeds.latest({ kind: "guide" }), feeds.latest({ kind: "guide", cursor })]),
      )
      yield* run("lesson_lang_feed_idx", (feeds) =>
        Effect.all([feeds.latest({ lang: "th" }), feeds.latest({ lang: "th", cursor })]),
      )
      // The tag feed needs a tag to exist before it queries.
      yield* Effect.promise(() =>
        env.db
          .prepare(
            "insert into tag (id, slug, name, lesson_count) values ('plan-tag', 'plan-tag', 'plan-tag', 0)",
          )
          .run(),
      )
      yield* run("lesson_tag_hot_idx", (feeds) =>
        Effect.all([feeds.tag("plan-tag", { sort: "hot" }), feeds.tag("plan-tag", { sort: "hot", cursor })]),
      )
      const feedQueries = recorded.filter((statement) => /order by .* desc limit/s.test(statement.sql))
      assert.strictEqual(feedQueries.length, expected.length)
      for (const [index, statement] of feedQueries.entries()) {
        const details = yield* plan(env.db, statement)
        assert.isTrue(
          details.some((detail) => new RegExp(`USING (COVERING )?INDEX ${expected[index]}\\b`).test(detail)),
          `${expected[index]}:\n${details.join("\n")}`,
        )
        // The unfiltered first page walks its partial index in feed order and stops after
        // `limit + 1` rows (SQLite calls that a SCAN); anything else must be a SEARCH.
        const walk = new RegExp(`^SCAN \\w+ USING (COVERING )?INDEX ${expected[index]}$`)
        assert.isFalse(
          details.some((detail) => !walk.test(detail) && costly(detail)),
          details.join("\n"),
        )
      }
    }),
  )

  it.effect("searches lessons through FTS, and keeps its rows by rowid", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const author = yield* signIn("Plan Author")
      const published = yield* author.client.lessons.publish({
        params: { slug: "plan-search" },
        payload: jsonBytes(tinyLesson("en", "plan-search")),
      })
      const id = LessonIdSchema.make(published.lesson.id)
      const recorded: Array<Recorded> = []
      const database = recordingDatabase(env.db, recorded)
      const recorder = Layer.mergeAll(
        Layer.fresh(Lessons.layer).pipe(Layer.provide(Layer.mergeAll(database, StorageR2(env.bucket)))),
        Layer.fresh(LessonSearch.layer).pipe(Layer.provide(database)),
      )
      yield* Effect.gen(function* () {
        const lessons = yield* Lessons
        const search = yield* LessonSearch
        yield* lessons.update(id, { visibility: "public", category_id: "math", tags: ["plan"] })
        const hits = yield* search.search({ q: "plan" })
        assert.deepStrictEqual(
          hits.items.map((item) => item.id),
          [id],
        )
        yield* search.search({ q: "พื้นฐาน", lang: "th" })
        yield* lessons.remove(id)
      }).pipe(
        Effect.provide(recorder),
        Effect.provideService(CurrentUser, {
          id: UserId.make(author.user.id),
          email: author.user.email,
          name: author.user.name,
          image: null,
          viaToken: false,
        }),
      )
      const ftsStatements = recorded.filter((statement) => statement.sql.includes("lesson_fts"))
      // update: delete + insert; search twice; remove: delete + insert (inserts nothing).
      assert.strictEqual(ftsStatements.length, 6)
      for (const statement of ftsStatements) {
        const details = yield* plan(env.db, statement)
        assert.isFalse(details.some(costly), details.join("\n"))
      }
      const syncs = recorded.filter((statement) =>
        /^\s*update lesson_lang set\s+is_public/.test(statement.sql),
      )
      assert.strictEqual(syncs.length, 2)
      for (const statement of syncs) {
        const details = yield* plan(env.db, statement)
        assert.isFalse(details.some(costly), details.join("\n"))
      }
    }),
  )

  it.effect("recomputes hot scores from index ranges, never a full scan", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const recorded: Array<Recorded> = []
      const recorder = Layer.fresh(HotScore.layer).pipe(Layer.provide(recordingDatabase(env.db, recorded)))
      yield* HotScore.use((hot) => hot.recompute(Date.now())).pipe(Effect.provide(recorder))
      assert.strictEqual(recorded.length, 2)
      for (const statement of recorded) {
        const details = yield* plan(env.db, statement)
        assert.isTrue(
          details.some((detail) => /lesson_new_idx|lesson_tag_recent_idx/.test(detail)),
          details.join("\n"),
        )
        assert.isFalse(details.some(costly), details.join("\n"))
      }
    }),
  )

  it.effect("keeps tag and author counters exact through re-tags, visibility and delete", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const author = yield* signIn("Counter Author")
      const lessonOf = (slug: string) =>
        author.client.lessons
          .publish({ params: { slug }, payload: jsonBytes(tinyLesson("en", slug)) })
          .pipe(Effect.map((published) => published.lesson.id))
      const update = (id: LessonId, payload: Parameters<typeof author.client.lessons.update>[0]["payload"]) =>
        author.client.lessons.update({ params: { id }, payload })
      const counts = (slugs: ReadonlyArray<string>) =>
        tagCounts(env.db).pipe(Effect.map((all) => slugs.map((slug) => all[slug] ?? 0)))
      const mine = () => author.client.me.get().pipe(Effect.map((me) => me.lesson_count))

      const first = yield* lessonOf("count-first")
      const second = yield* lessonOf("count-second")
      // Private lessons count nowhere, even with tags.
      yield* update(first, { category_id: "math", tags: ["cnt-a", "cnt-b"] })
      assert.deepStrictEqual(yield* counts(["cnt-a", "cnt-b"]), [0, 0])

      yield* update(first, { visibility: "public" })
      assert.deepStrictEqual(yield* counts(["cnt-a", "cnt-b"]), [1, 1])
      assert.strictEqual(yield* mine(), 1)
      // A settings change that keeps it public moves nothing.
      yield* update(first, { category_id: "math.algebra" })
      assert.deepStrictEqual(yield* counts(["cnt-a", "cnt-b"]), [1, 1])
      assert.strictEqual(yield* mine(), 1)

      yield* update(first, { tags: ["cnt-b", "cnt-c"] })
      assert.deepStrictEqual(yield* counts(["cnt-a", "cnt-b", "cnt-c"]), [0, 1, 1])

      yield* update(second, { visibility: "public", category_id: "math", tags: ["cnt-b"] })
      assert.deepStrictEqual(yield* counts(["cnt-a", "cnt-b", "cnt-c"]), [0, 2, 1])
      assert.strictEqual(yield* mine(), 2)

      yield* update(first, { visibility: "unlisted" })
      assert.deepStrictEqual(yield* counts(["cnt-b", "cnt-c"]), [1, 0])
      assert.strictEqual(yield* mine(), 1)
      yield* update(first, { visibility: "public" })
      assert.deepStrictEqual(yield* counts(["cnt-b", "cnt-c"]), [2, 1])

      yield* author.client.lessons.delete({ params: { id: first } })
      assert.deepStrictEqual(yield* counts(["cnt-a", "cnt-b", "cnt-c"]), [0, 1, 0])
      assert.strictEqual(yield* mine(), 1)
      yield* author.client.lessons.delete({ params: { id: second } })
      assert.deepStrictEqual(yield* counts(["cnt-b"]), [0])
      assert.strictEqual(yield* mine(), 0)

      // The counters match a full recount.
      const drift = yield* Effect.promise(() =>
        env.db
          .prepare(
            `select count(*) as n from tag t where t.lesson_count <>
              (select count(*) from lesson_tag lt where lt.tag_id = t.id and lt.is_public = 1)`,
          )
          .first<{ n: number }>(),
      )
      assert.strictEqual(drift?.n, 0)
    }),
  )

  it.effect("keeps like_count exact through repeated likes, unlikes and a delete", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const author = yield* signIn("Liked Author")
      const fans = [yield* signIn("Fan One"), yield* signIn("Fan Two"), yield* signIn("Fan Three")]
      const published = yield* author.client.lessons.publish({
        params: { slug: "liked" },
        payload: jsonBytes(tinyLesson("en", "liked")),
      })
      const id = published.lesson.id
      yield* author.client.lessons.update({
        params: { id },
        payload: { visibility: "public", category_id: "math", tags: ["liked"] },
      })
      const [one, two, three] = fans
      if (one === undefined || two === undefined || three === undefined) return assert.fail("no fans")
      const like = (fan: typeof one) => fan.client.engagement.like({ params: { id } })
      const unlike = (fan: typeof one) => fan.client.engagement.unlike({ params: { id } })
      const count = () => author.client.lessons.get({ params: { id } }).pipe(Effect.map((l) => l.like_count))
      const rows = (table: string) =>
        Effect.promise(() =>
          env.db
            .prepare(`select count(*) as n from ${table} where lesson_id = ?`)
            .bind(id)
            .first<{ n: number }>(),
        ).pipe(Effect.map((row) => row?.n ?? -1))

      assert.deepStrictEqual(yield* like(one), { liked: true, like_count: 1 })
      // Liking twice is one like.
      assert.deepStrictEqual(yield* like(one), { liked: true, like_count: 1 })
      yield* like(two)
      // The same user liking many times at once still counts once.
      yield* Effect.all(
        Array.from({ length: 5 }, () => like(three)),
        { concurrency: "unbounded" },
      )
      assert.strictEqual(yield* count(), 3)
      assert.deepStrictEqual(yield* unlike(one), { liked: false, like_count: 2 })
      assert.deepStrictEqual(yield* unlike(one), { liked: false, like_count: 2 })
      yield* Effect.all(
        Array.from({ length: 5 }, () => unlike(two)),
        { concurrency: "unbounded" },
      )
      assert.strictEqual(yield* count(), 1)
      assert.strictEqual(yield* rows("lesson_like"), 1)
      // The feeds show the same count.
      const anon = yield* anonymous()
      const feed = yield* anon.feeds.new({ query: {} })
      assert.strictEqual(feed.items.find((item) => item.id === id)?.like_count, 1)

      // The counter matches a recount, for every lesson.
      const drift = yield* Effect.promise(() =>
        env.db
          .prepare(
            `select count(*) as n from lesson l where l.deleted_at is null and l.like_count <>
              (select count(*) from lesson_like k where k.lesson_id = l.id)`,
          )
          .first<{ n: number }>(),
      )
      assert.strictEqual(drift?.n, 0)

      // Progress and bookmarks too, then the delete takes all of it with the lesson.
      yield* two.client.engagement.bookmark({ params: { id } })
      yield* two.client.engagement.bookmark({ params: { id } })
      const progress = { version_id: published.version.id, last: "intro", seen: ["intro"], total: 2 }
      yield* two.client.engagement.saveProgress({ params: { id }, payload: progress })
      const first = (yield* two.client.lessons.get({ params: { id } })).viewer?.progress
      // Sending the same progress again writes nothing (the row keeps its time).
      yield* two.client.engagement.saveProgress({ params: { id }, payload: progress })
      const second = (yield* two.client.lessons.get({ params: { id } })).viewer?.progress
      assert.isDefined(first)
      assert.strictEqual(second?.updated_at, first?.updated_at)
      assert.strictEqual(yield* rows("bookmark"), 1)
      // Every section seen: done, and out of "Continue learning".
      assert.strictEqual((yield* two.client.engagement.progress({ query: {} })).items.length, 1)
      yield* two.client.engagement.saveProgress({
        params: { id },
        payload: { ...progress, seen: ["intro", "intro", "next"] },
      })
      const done = (yield* two.client.lessons.get({ params: { id } })).viewer?.progress
      assert.strictEqual(done?.done, true)
      assert.deepStrictEqual(done?.seen, ["intro", "next"])
      assert.strictEqual((yield* two.client.engagement.progress({ query: {} })).items.length, 0)

      yield* author.client.lessons.delete({ params: { id } })
      assert.deepStrictEqual(
        [yield* rows("lesson_like"), yield* rows("bookmark"), yield* rows("progress")],
        [0, 0, 0],
      )
      const deleted = yield* Effect.promise(() =>
        env.db.prepare("select like_count from lesson where id = ?").bind(id).first<{ like_count: number }>(),
      )
      assert.strictEqual(deleted?.like_count, 0)
    }),
  )

  it.effect("reads likes, bookmarks and progress from index ranges and primary keys", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const reader = yield* signIn("Plan Reader")
      const author = yield* signIn("Plan Writer")
      const published = yield* author.client.lessons.publish({
        params: { slug: "plan-engagement" },
        payload: jsonBytes(tinyLesson("en", "plan-engagement")),
      })
      const id = LessonIdSchema.make(published.lesson.id)
      yield* author.client.lessons.update({
        params: { id },
        payload: { visibility: "public", category_id: "math", tags: ["plan-engagement"] },
      })
      const recorded: Array<Recorded> = []
      const database = recordingDatabase(env.db, recorded)
      const recorder = Layer.mergeAll(
        Layer.fresh(Engagement.layer).pipe(Layer.provide(database)),
        Layer.fresh(Lessons.layer).pipe(Layer.provide(Layer.mergeAll(database, StorageR2(env.bucket)))),
      )
      const as = (user: typeof reader) => ({
        id: UserId.make(user.user.id),
        email: user.user.email,
        name: user.user.name,
        image: null,
        viaToken: false,
      })
      const cursor = { at: Date.now(), id }
      yield* Effect.gen(function* () {
        const engagement = yield* Engagement
        const lessons = yield* Lessons
        yield* engagement.like(id)
        yield* engagement.unlike(id)
        yield* engagement.bookmark(id)
        yield* engagement.saveProgress(id, {
          version_id: published.version.id,
          last: "intro",
          seen: ["intro"],
          total: 3,
        })
        assert.strictEqual((yield* engagement.bookmarks({})).items.length, 1)
        yield* engagement.bookmarks({ cursor, limit: 2 })
        assert.strictEqual((yield* engagement.progress({})).items.length, 1)
        yield* engagement.progress({ cursor, limit: 2 })
        yield* lessons.asUser.get(id)
      }).pipe(Effect.provide(recorder), Effect.provideService(CurrentUser, as(reader)))
      yield* Lessons.use((lessons) => lessons.remove(id)).pipe(
        Effect.provide(recorder),
        Effect.provideService(CurrentUser, as(author)),
      )

      const touches = recorded.filter((statement) => /lesson_like|bookmark|progress/.test(statement.sql))
      // like (2) + unlike (2) + their states (2) + bookmark + progress write + 2 bookmark pages +
      // 2 progress pages + the viewer state + the delete's 3.
      assert.isAtLeast(touches.length, 16)
      for (const statement of touches) {
        const details = yield* plan(env.db, statement)
        assert.isFalse(details.some(costly), `${statement.sql}\n${details.join("\n")}`)
      }
      const lists = recorded.filter((statement) => /order by (b|pr)\./.test(statement.sql))
      assert.strictEqual(lists.length, 4)
      for (const statement of lists) {
        const details = yield* plan(env.db, statement)
        assert.isTrue(
          details.some((detail) => /INDEX (bookmark_user_idx|progress_user_idx)\b/.test(detail)),
          details.join("\n"),
        )
      }
      const deletes = recorded.filter((statement) =>
        /^\s*delete from (lesson_like|bookmark|progress) where lesson_id/.test(statement.sql),
      )
      assert.strictEqual(deletes.length, 3)
      for (const statement of deletes) {
        const details = yield* plan(env.db, statement)
        assert.isTrue(
          details.some((detail) =>
            /INDEX (lesson_like_lesson_idx|bookmark_lesson_idx|progress_lesson_idx)\b/.test(detail),
          ),
          details.join("\n"),
        )
      }
    }),
  )

  it.effect("reads comments and the report queue from index ranges and primary keys", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const author = yield* signIn("Plan Commenter")
      yield* signInAdmin()
      const published = yield* author.client.lessons.publish({
        params: { slug: "plan-comments" },
        payload: jsonBytes(tinyLesson("en", "plan-comments")),
      })
      const id = LessonIdSchema.make(published.lesson.id)
      yield* author.client.lessons.update({
        params: { id },
        payload: { visibility: "public", category_id: "math", tags: ["plan-comments"] },
      })
      const recorded: Array<Recorded> = []
      const database = recordingDatabase(env.db, recorded)
      const recorder = Layer.mergeAll(
        Layer.fresh(Comments.layer).pipe(Layer.provide(database)),
        Layer.fresh(Reports.layer).pipe(Layer.provide(database)),
      )
      const user = {
        id: UserId.make(author.user.id),
        email: author.user.email,
        name: author.user.name,
        image: null,
        viaToken: false,
      }
      const cursor = { at: Date.now(), id }
      yield* Effect.gen(function* () {
        const comments = yield* Comments
        const reports = yield* Reports
        const make = (body: string, parent_id?: CommentId) =>
          comments.create(id, {
            version_id: published.version.id,
            anchor: "section:intro",
            body,
            ...(parent_id === undefined ? {} : { parent_id }),
          })
        const top = yield* make("top")
        const reply = yield* make("reply", top.id)
        yield* comments.edit(id, reply.id, "reply, edited")
        yield* comments.hide(id, reply.id)
        yield* comments.unhide(id, reply.id)
        yield* comments.remove(id, reply.id)
        assert.strictEqual((yield* comments.asUser.list(id, {})).items.length, 1)
        yield* comments.asUser.list(id, { cursor, limit: 2 })
        yield* comments.asUser.list(id, { anchor: "section:intro" })
        yield* comments.asUser.list(id, { anchor: "section:intro", cursor, limit: 2 })
        yield* comments.anonymous.list(id, {})
        yield* reports.create({ target_type: "comment", target_id: top.id, reason: "spam" })
        yield* reports.create({ target_type: "lesson", target_id: id, reason: "other", note: "dup" })
        yield* Effect.gen(function* () {
          const queue = yield* reports.queue({})
          assert.isAtLeast(queue.items.length, 2)
          yield* reports.queue({ cursor: { at: Date.now(), id }, limit: 2 })
          const first = queue.items[0]
          if (first !== undefined) yield* reports.resolve(first.id, { status: "resolved" })
          yield* comments.adminHide(top.id)
          yield* comments.adminUnhide(top.id)
        }).pipe(Effect.provideService(CurrentAdmin, { id: UserId.make(adminUserId) }))
      }).pipe(Effect.provide(recorder), Effect.provideService(CurrentUser, user))

      const touches = recorded.filter((statement) => /\b(comment|report)\b/.test(statement.sql))
      assert.isAtLeast(touches.length, 25)
      // The queue's first page walks report_queue_idx (open reports only) in order and stops after
      // `limit + 1` rows, like an unfiltered feed; everything else is a SEARCH.
      const queueWalk = /^SCAN r USING INDEX report_queue_idx$/
      for (const statement of touches) {
        const details = yield* plan(env.db, statement)
        assert.isFalse(
          details.some((detail) => costly(detail) && !queueWalk.test(detail)),
          `${statement.sql}\n${details.join("\n")}`,
        )
      }
      // The lists: one range of the matching index each, in order.
      const threads = recorded.filter((statement) => /order by c\.created_at desc/.test(statement.sql))
      assert.strictEqual(threads.length, 5)
      for (const statement of threads) {
        const details = yield* plan(env.db, statement)
        const wanted = statement.sql.includes("c.anchor =") ? "comment_anchor_idx" : "comment_thread_idx"
        assert.isTrue(
          details.some((detail) => detail.includes(wanted)),
          details.join("\n"),
        )
      }
      const replies = recorded.filter((statement) => statement.sql.includes("c.parent_id in"))
      assert.isAtLeast(replies.length, 1)
      for (const statement of replies) {
        const details = yield* plan(env.db, statement)
        assert.isTrue(
          details.some((detail) => detail.includes("comment_reply_idx")),
          details.join("\n"),
        )
      }
      const queues = recorded.filter((statement) => /order by r\.created_at desc/.test(statement.sql))
      assert.strictEqual(queues.length, 2)
      for (const statement of queues) {
        const details = yield* plan(env.db, statement)
        assert.isTrue(
          details.some((detail) => detail.includes("report_queue_idx")),
          details.join("\n"),
        )
      }
      const resolves = recorded.filter((statement) => /^\s*update report set status/.test(statement.sql))
      assert.strictEqual(resolves.length, 1)
      for (const statement of resolves) {
        const details = yield* plan(env.db, statement)
        assert.isTrue(
          details.some((detail) => detail.includes("report_target_idx")),
          details.join("\n"),
        )
      }
    }),
  )

  it.effect("replaces a concept's search row by rowid", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const author = yield* signIn("Search Author")
      const anon = yield* anonymous()
      const base = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(
        readContent("concepts/physics.total-time/en.json"),
      )
      const body = (alias: string) => jsonBytes({ ...base, aliases: [alias] })
      const found = (q: string) =>
        anon.concepts.search({ query: { q } }).pipe(Effect.map((hits) => hits.map((hit) => hit.slug)))

      yield* author.client.concepts.publish({ payload: body("zebrawordone") })
      assert.deepStrictEqual(yield* found("zebrawordone"), ["physics.total-time"])

      // The next version, through the service, recording its SQL.
      const recorded: Array<Recorded> = []
      const recorder = Layer.fresh(Concepts.layer).pipe(
        Layer.provide(Layer.mergeAll(recordingDatabase(env.db, recorded), StorageR2(env.bucket))),
      )
      yield* Concepts.use((concepts) => concepts.publish(body("quokkawordtwo"))).pipe(
        Effect.provide(recorder),
        Effect.provideService(CurrentUser, {
          id: UserId.make(author.user.id),
          email: author.user.email,
          name: author.user.name,
          image: null,
          viaToken: false,
        }),
      )
      assert.deepStrictEqual(yield* found("zebrawordone"), [])
      assert.deepStrictEqual(yield* found("quokkawordtwo"), ["physics.total-time"])
      const rows = yield* Effect.promise(() =>
        env.db.prepare("select count(*) as n from concept_fts").first<{ n: number }>(),
      )
      assert.strictEqual(rows?.n, 1)

      const ftsWrites = recorded.filter((statement) =>
        /^\s*(delete from|insert into) concept_fts/.test(statement.sql),
      )
      assert.strictEqual(ftsWrites.length, 2)
      for (const statement of ftsWrites) {
        const details = yield* plan(env.db, statement)
        assert.isFalse(details.some(costly), details.join("\n"))
      }
      // The deploy-window repair runs before every publish: with nothing to repair, a rowid range
      // of concept_fts and a range of the fts_rowid index. The next rowid reads one row of each.
      const upkeep = recorded.filter(
        (statement) =>
          statement.sql.includes("from concept_fts") || statement.sql.includes("fts_rowid is null"),
      )
      assert.isAtLeast(upkeep.length, 2)
      // `INDEX 192:` is FTS5's rowid-descending scan (ORDER_ROWID | ORDER_DESC); under `limit 1`
      // it stops at the first row, checked below with D1's own rows_read.
      const lastRowid = /VIRTUAL TABLE INDEX 192:$/
      const inserts = recorded.filter((statement) => statement.sql.includes("insert into concept_lang"))
      for (const statement of [...upkeep, ...inserts]) {
        const details = yield* plan(env.db, statement)
        assert.isFalse(
          details.some((detail) => costly(detail) && !lastRowid.test(detail)),
          `${statement.sql}\n${details.join("\n")}`,
        )
      }
      const read = (query: string) =>
        Effect.promise(() => env.db.prepare(query).run()).pipe(Effect.map((result) => result.meta.rows_read))
      yield* Effect.promise(() =>
        env.db.batch(
          Array.from({ length: 20 }, (_, index) =>
            env.db
              .prepare("insert into concept_fts (concept_id, lang, search) values ('filler', 'en', ?)")
              .bind(`filler${index}`),
          ),
        ),
      )
      const all = yield* read("select rowid from concept_fts")
      const last = yield* read("select rowid from concept_fts order by rowid desc limit 1")
      assert.isAtLeast(all, 20)
      assert.isAtMost(last, 2)
      yield* Effect.promise(() => env.db.prepare("delete from concept_fts where concept_id = 'filler'").run())
    }),
  )

  it.effect("sets security headers on the Worker's responses and the SPA's assets", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const workerEnv = {
        DB: env.db,
        CONTENT: env.bucket,
        APP_ENV: "test",
        BETTER_AUTH_SECRET: "f/PV4CMPZKwdOG1J+AWa1m2H+XYmlFZpwIlptI9GGVg=",
        BETTER_AUTH_URL: "http://localhost:3000",
        GOOGLE_CLIENT_ID: "test-client-id",
        GOOGLE_CLIENT_SECRET: "test-client-secret",
      }
      // Liveness (answered before the app), an API read, and a 404.
      for (const path of ["/api/health", "/api/categories", "/api/lessons/nope"]) {
        const response = yield* Effect.promise(() =>
          handleFetch(new Request(`http://localhost:3000${path}`), workerEnv, () => undefined),
        )
        for (const [name, value] of Object.entries(securityHeaders))
          assert.strictEqual(response.headers.get(name), value, `${path} ${name}`)
      }
      assert.include(securityHeaders["content-security-policy"] ?? "", "frame-ancestors 'none'")

      // The SPA is served as static assets, without the Worker: its headers come from _headers.
      const web = join(import.meta.dirname, "../../web")
      const rules = readFileSync(join(web, "public/_headers"), "utf8")
        .split("\n")
        .filter((line) => !line.startsWith("#") && line.trim() !== "")
      assert.strictEqual(rules[0], "/*")
      const headers = new Map(
        rules.slice(1).map((line) => {
          const at = line.indexOf(":")
          return [line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim()] as const
        }),
      )
      const csp = headers.get("content-security-policy") ?? ""
      assert.include(csp, "script-src 'self';")
      assert.include(csp, "frame-ancestors 'none'")
      assert.include(csp, "object-src 'none'")
      assert.strictEqual(headers.get("x-content-type-options"), "nosniff")
      assert.strictEqual(headers.get("referrer-policy"), securityHeaders["referrer-policy"])
      // script-src 'self' holds only while index.html has no inline script.
      const html = readFileSync(join(web, "index.html"), "utf8")
      const scripts = html.match(/<script\b[^>]*>/g) ?? []
      assert.isTrue(scripts.length > 0 && scripts.every((tag) => /\bsrc=/.test(tag)), scripts.join("\n"))
    }),
  )
})
