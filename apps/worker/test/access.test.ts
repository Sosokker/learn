import { lessonScript } from "@app/agent"
import { CurrentUser, LessonId, LessonVersionId, platformUserId, UserId } from "@app/api"
import { D1, Database } from "@app/db"
import { Comments, Concepts, Engagement } from "@app/services"
import { assert, layer } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { StorageR2 } from "../src/storage-r2.ts"
import {
  anonymous,
  clientWith,
  jsonBytes,
  rawFetch,
  readContent,
  signIn,
  signInAdmin,
  TestEnv,
  TestLayer,
  tinyLesson,
} from "./support.ts"

const platformUser = {
  id: platformUserId,
  name: "Learn",
  email: "learn@users.invalid",
  image: null,
  viaToken: false,
}

// "ok", "404" for LessonNotFound (or CommentNotFound), or the tag of any other failure (which
// fails the assertion).
const outcome = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.map(() => "ok"),
    Effect.catch((error) =>
      Effect.succeed(
        error._tag === "LessonNotFound" || error._tag === "CommentNotFound" ? "404" : error._tag,
      ),
    ),
  )

// Who can read what: owner / another user / anonymous × private / unlisted / public, through every
// read path (API and /c/<hash>.json).
layer(TestLayer, { excludeTestServices: true })("access control", (it) => {
  it.effect("matrix of readers and visibilities", () =>
    Effect.gen(function* () {
      const owner = yield* signIn("Owner Person")
      const other = yield* signIn("Other Person")
      const anon = yield* anonymous()

      const publish = (slug: string) =>
        owner.client.lessons.publish({ params: { slug }, payload: jsonBytes(tinyLesson("en", slug)) })
      const priv = yield* publish("secret-notes")
      const unl = yield* publish("shared-link")
      const pub = yield* publish("for-everyone")
      assert.strictEqual(priv.lesson.visibility, "private")

      yield* owner.client.lessons.update({
        params: { id: unl.lesson.id },
        payload: { visibility: "unlisted" },
      })
      yield* owner.client.lessons.update({
        params: { id: pub.lesson.id },
        payload: { visibility: "public", category_id: "math", tags: ["Algebra"] },
      })

      const handle = priv.lesson.owner_handle
      const cases = [
        { name: "private", published: priv, everyone: false },
        { name: "unlisted", published: unl, everyone: true },
        { name: "public", published: pub, everyone: true },
      ]
      const readers = [
        { name: "owner", client: owner.client, owner: true },
        { name: "other", client: other.client, owner: false },
        { name: "anonymous", client: anon, owner: false },
      ]
      for (const c of cases) {
        const id = c.published.lesson.id
        const versionId = c.published.version.id
        for (const reader of readers) {
          const label = `${reader.name} reading ${c.name}`
          const allowed = c.everyone || reader.owner
          const outcomes = [
            yield* outcome(reader.client.lessons.get({ params: { id } })),
            yield* outcome(
              reader.client.lessons.getBySlug({ params: { handle, slug: c.published.lesson.slug } }),
            ),
            yield* outcome(reader.client.lessons.versions({ params: { id }, query: {} })),
            yield* outcome(reader.client.lessons.body({ params: { id, versionId } })),
            yield* outcome(reader.client.lessons.concepts({ params: { id, versionId } })),
          ]
          assert.deepStrictEqual(outcomes, Array(5).fill(allowed ? "ok" : "404"), label)
          if (allowed) {
            const lesson = yield* reader.client.lessons.get({ params: { id } })
            assert.strictEqual(lesson.is_owner, reader.owner, label)
            const body = yield* reader.client.lessons.body({ params: { id, versionId } })
            assert.strictEqual(body.title, c.published.lesson.title, label)
          }
        }
        // The immutable URL serves public and unlisted bodies only; a private body never goes out
        // there, not even to its owner (the cookie is ignored).
        const content = yield* rawFetch(`/c/${c.published.version.body_hash}.json`, {
          headers: { cookie: owner.cookie },
        })
        assert.strictEqual(content.status, c.everyone ? 200 : 404, `/c/ for ${c.name}`)
        // The concept bundle of a version never changes: the browser may keep a public or unlisted
        // one, no shared cache may (the lesson can turn private), and a private one is never kept.
        const bundle = yield* rawFetch(
          `/api/lessons/${c.published.lesson.id}/versions/${c.published.version.id}/concepts`,
          { headers: { cookie: owner.cookie } },
        )
        assert.strictEqual(bundle.status, 200, `bundle for ${c.name}`)
        assert.strictEqual(
          bundle.headers.get("cache-control"),
          c.everyone ? "private, max-age=31536000, immutable" : "private, no-store",
          `bundle cache for ${c.name}`,
        )
        if (c.everyone) {
          assert.strictEqual(content.headers.get("cache-control"), "public, max-age=31536000, immutable")
          const text = yield* Effect.promise(() => content.text())
          assert.include(text, c.published.lesson.slug)
        }
      }

      // The private body through the API is never cacheable.
      const privateBody = yield* rawFetch(`/api/lessons/${priv.lesson.id}/versions/${priv.version.id}/body`, {
        headers: { cookie: owner.cookie },
      })
      assert.strictEqual(privateBody.status, 200)
      assert.strictEqual(privateBody.headers.get("cache-control"), "private, no-store")

      // Feeds list public lessons only; the library lists all of the owner's own.
      const feed = yield* anon.feeds.new({ query: {} })
      assert.deepStrictEqual(
        feed.items.map((item) => item.id),
        [pub.lesson.id],
      )
      const byTag = yield* anon.feeds.tag({ params: { slug: "algebra" }, query: {} })
      assert.deepStrictEqual(
        byTag.items.map((item) => item.id),
        [pub.lesson.id],
      )
      // So do the hot and filtered feeds, and search: for everyone, the owner too (search has no
      // viewer; the index holds public lessons only).
      const publicOnly = [pub.lesson.id]
      const ids = (page: { readonly items: ReadonlyArray<{ readonly id: string }> }) =>
        page.items.map((item) => item.id)
      assert.deepStrictEqual(ids(yield* anon.feeds.hot({ query: {} })), publicOnly)
      assert.deepStrictEqual(ids(yield* anon.feeds.new({ query: { kind: "learn" } })), publicOnly)
      assert.deepStrictEqual(ids(yield* anon.feeds.new({ query: { lang: "en" } })), publicOnly)
      assert.deepStrictEqual(ids(yield* anon.feeds.hot({ query: { kind: "learn" } })), publicOnly)
      assert.deepStrictEqual(
        ids(yield* anon.feeds.tag({ params: { slug: "algebra" }, query: { sort: "hot" } })),
        publicOnly,
      )
      for (const reader of readers) {
        const hits = yield* reader.client.lessons.search({ query: { q: "tiny" } })
        assert.deepStrictEqual(ids(hits), publicOnly, `${reader.name} searching`)
        const bySlugWord = yield* reader.client.lessons.search({ query: { q: "secret" } })
        assert.deepStrictEqual(ids(bySlugWord), [], `${reader.name} searching for a private lesson`)
      }

      const mine = yield* owner.client.lessons.mine({ query: {} })
      assert.sameMembers(
        mine.items.map((item) => item.id),
        [priv.lesson.id, unl.lesson.id, pub.lesson.id],
      )
      const othersLibrary = yield* other.client.lessons.mine({ query: {} })
      assert.strictEqual(othersLibrary.items.length, 0)

      // Changing someone else's lesson looks exactly like a missing lesson.
      for (const target of [priv, pub]) {
        const update = yield* other.client.lessons
          .update({ params: { id: target.lesson.id }, payload: { visibility: "public" } })
          .pipe(Effect.flip)
        assert.strictEqual(update._tag, "LessonNotFound")
        const removal = yield* other.client.lessons
          .delete({ params: { id: target.lesson.id } })
          .pipe(Effect.flip)
        assert.strictEqual(removal._tag, "LessonNotFound")
      }
      const anonymousUpdate = yield* anon.lessons
        .update({ params: { id: pub.lesson.id }, payload: { visibility: "private" } })
        .pipe(Effect.flip)
      assert.strictEqual(anonymousUpdate._tag, "Unauthenticated")
      const anonymousPublish = yield* anon.lessons
        .publish({ params: { slug: "nope" }, payload: jsonBytes(tinyLesson("en", "nope")) })
        .pipe(Effect.flip)
      assert.strictEqual(anonymousPublish._tag, "Unauthenticated")

      // Public → private: the body leaves /c/ and the lesson leaves the feeds at once.
      yield* owner.client.lessons.update({
        params: { id: pub.lesson.id },
        payload: { visibility: "private" },
      })
      const hidden = yield* rawFetch(`/c/${pub.version.body_hash}.json`)
      assert.strictEqual(hidden.status, 404)
      assert.strictEqual((yield* anon.feeds.new({ query: {} })).items.length, 0)
      assert.strictEqual((yield* anon.feeds.tag({ params: { slug: "algebra" }, query: {} })).items.length, 0)
      // A tag used only by private lessons and a tag nobody uses answer the same: an empty 200,
      // so the feed cannot tell whether a private lesson carries a tag.
      const privateOnly = yield* rawFetch("/api/feeds/tags/algebra")
      const unknown = yield* rawFetch("/api/feeds/tags/no-such-tag-anywhere")
      assert.strictEqual(privateOnly.status, 200)
      assert.strictEqual(unknown.status, 200)
      assert.deepStrictEqual(
        yield* Effect.promise(() => unknown.json()),
        yield* Effect.promise(() => privateOnly.json()),
      )

      // A deleted unlisted lesson: gone for everyone, its body leaves /c/, and the slug is free.
      yield* owner.client.lessons.delete({ params: { id: unl.lesson.id } })
      const deleted = yield* owner.client.lessons.get({ params: { id: unl.lesson.id } }).pipe(Effect.flip)
      assert.strictEqual(deleted._tag, "LessonNotFound")
      assert.strictEqual((yield* rawFetch(`/c/${unl.version.body_hash}.json`)).status, 404)
      const again = yield* publish("shared-link")
      assert.notStrictEqual(again.lesson.id, unl.lesson.id)
      assert.strictEqual(again.version.n, 1)

      // Malformed hashes and unknown hashes are plain 404s.
      assert.strictEqual((yield* rawFetch("/c/../../secret.json")).status, 404)
      assert.strictEqual((yield* rawFetch(`/c/${"0".repeat(64)}.json`)).status, 404)
    }),
  )

  it.effect("keeps platform names for the platform user", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const user = yield* signIn("Name Squatter")
      const concept = (slug: string) =>
        jsonBytes(Object.assign({}, readContent("concepts/physics.total-time/en.json"), { slug }))

      const squat = yield* user.client.concepts
        .publish({ payload: concept("platform.start-here") })
        .pipe(Effect.flip)
      assert.strictEqual(squat._tag, "ConceptForbidden")

      // A concept the platform user owns: nobody else adds versions to it.
      yield* Effect.promise(() =>
        env.db.batch([
          env.db.prepare(
            `insert into "user" (id, name, email, email_verified, image, created_at, updated_at)
            values ('learn', 'Learn', 'learn@users.invalid', 0, null, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
          ),
          env.db.prepare("insert into profile (user_id, handle, created_at) values ('learn', 'learn', 0)"),
        ]),
      )
      // As the seed does: the platform user publishes through the service, not over HTTP.
      const asPlatform = (slug: string) =>
        Concepts.use((concepts) => concepts.publish(concept(slug))).pipe(
          Effect.provide(Concepts.layer.pipe(Layer.provide(StorageR2(env.bucket)))),
          Effect.provideService(CurrentUser, platformUser),
        )
      yield* asPlatform("physics.total-time")
      yield* asPlatform("platform.welcome")
      for (const slug of ["physics.total-time", "platform.welcome"]) {
        const takeover = yield* user.client.concepts.publish({ payload: concept(slug) }).pipe(Effect.flip)
        assert.strictEqual(takeover._tag, "ConceptForbidden", slug)
      }

      // The `platform` category tree is the platform's own.
      const lesson = yield* user.client.lessons.publish({
        params: { slug: "official-looking" },
        payload: jsonBytes(tinyLesson("en", "official-looking")),
      })
      for (const category_id of ["platform", "platform.guide"]) {
        const refused = yield* user.client.lessons
          .update({ params: { id: lesson.lesson.id }, payload: { category_id } })
          .pipe(Effect.flip)
        assert.strictEqual(refused._tag, "InvalidSettings", category_id)
      }
      const fine = yield* user.client.lessons.update({
        params: { id: lesson.lesson.id },
        payload: { category_id: "math" },
      })
      assert.strictEqual(fine.category_id, "math")
    }),
  )

  it.effect("another user's API token sees a private lesson as missing", () =>
    Effect.gen(function* () {
      const owner = yield* signIn("Token Lesson Owner")
      const other = yield* signIn("Token Stranger")
      const priv = yield* owner.client.lessons.publish({
        params: { slug: "token-secret" },
        payload: jsonBytes(tinyLesson("en", "token-secret")),
      })
      const created = yield* other.client.tokens.create({ payload: { name: "stranger" } })
      const stranger = yield* clientWith({ authorization: `Bearer ${created.secret}` })
      const id = priv.lesson.id
      const versionId = priv.version.id
      const outcomes = [
        yield* outcome(stranger.lessons.get({ params: { id } })),
        yield* outcome(stranger.lessons.versions({ params: { id }, query: {} })),
        yield* outcome(stranger.lessons.body({ params: { id, versionId } })),
        yield* outcome(stranger.lessons.update({ params: { id }, payload: { visibility: "public" } })),
        yield* outcome(stranger.lessons.delete({ params: { id } })),
      ]
      assert.deepStrictEqual(outcomes, Array(5).fill("404"))
      // Publishing the same slug with the stranger's token makes the stranger's own lesson.
      const theirs = yield* stranger.lessons.publish({
        params: { slug: "token-secret" },
        payload: jsonBytes(tinyLesson("en", "token-secret-2")),
      })
      assert.notStrictEqual(theirs.lesson.id, id)
      assert.strictEqual((yield* owner.client.lessons.get({ params: { id } })).langs[0]?.n, 1)
    }),
  )

  it.effect("likes, bookmarks and progress follow lesson access", () =>
    Effect.gen(function* () {
      const owner = yield* signIn("Engaged Owner")
      const other = yield* signIn("Engaged Reader")
      const anon = yield* anonymous()
      const publish = (slug: string) =>
        owner.client.lessons.publish({ params: { slug }, payload: jsonBytes(tinyLesson("en", slug)) })
      const priv = yield* publish("eng-private")
      const unl = yield* publish("eng-unlisted")
      const pub = yield* publish("eng-public")
      yield* owner.client.lessons.update({
        params: { id: unl.lesson.id },
        payload: { visibility: "unlisted" },
      })
      yield* owner.client.lessons.update({
        params: { id: pub.lesson.id },
        payload: { visibility: "public", category_id: "math", tags: ["engagement"] },
      })

      const writes = (client: typeof owner.client, target: typeof priv) => {
        const id = target.lesson.id
        const progress = { version_id: target.version.id, last: "intro", seen: ["intro"], total: 1 }
        return Effect.all([
          outcome(client.engagement.like({ params: { id } })),
          outcome(client.engagement.unlike({ params: { id } })),
          outcome(client.engagement.bookmark({ params: { id } })),
          outcome(client.engagement.unbookmark({ params: { id } })),
          outcome(client.engagement.saveProgress({ params: { id }, payload: progress })),
        ])
      }
      // Another user's private lesson is missing, through every write; their own is fine.
      assert.deepStrictEqual(yield* writes(other.client, priv), Array(5).fill("404"))
      assert.deepStrictEqual(yield* writes(owner.client, priv), Array(5).fill("ok"))
      for (const target of [unl, pub]) {
        assert.deepStrictEqual(yield* writes(other.client, target), Array(5).fill("ok"))
      }
      // Anonymous readers cannot write at all.
      const anonymousLike = yield* anon.engagement.like({ params: { id: pub.lesson.id } }).pipe(Effect.flip)
      assert.strictEqual(anonymousLike._tag, "Unauthenticated")
      // A progress version must belong to the lesson.
      const wrongVersion = yield* other.client.engagement
        .saveProgress({
          params: { id: pub.lesson.id },
          payload: { version_id: unl.version.id, last: null, seen: [], total: 1 },
        })
        .pipe(Effect.flip)
      assert.strictEqual(wrongVersion._tag, "VersionNotFound")
      // Nothing was written for the private lesson by the other user.
      assert.strictEqual((yield* owner.client.lessons.get({ params: { id: priv.lesson.id } })).like_count, 0)

      // The reader bookmarks, likes and starts the two lessons they can see.
      for (const target of [unl, pub]) {
        const id = target.lesson.id
        yield* other.client.engagement.bookmark({ params: { id } })
        yield* other.client.engagement.like({ params: { id } })
        yield* other.client.engagement.saveProgress({
          params: { id },
          payload: { version_id: target.version.id, last: "intro", seen: ["intro"], total: 3 },
        })
      }
      const bookmarked = () =>
        other.client.engagement
          .bookmarks({ query: {} })
          .pipe(Effect.map((page) => page.items.map((item) => item.id)))
      const reading = () =>
        other.client.engagement
          .progress({ query: {} })
          .pipe(Effect.map((page) => page.items.map((item) => item.lesson.id)))
      assert.sameMembers(yield* bookmarked(), [unl.lesson.id, pub.lesson.id])
      assert.sameMembers(yield* reading(), [unl.lesson.id, pub.lesson.id])
      // The viewer state comes with the lesson, for the signed-in reader only.
      const seen = yield* other.client.lessons.get({ params: { id: pub.lesson.id } })
      assert.deepStrictEqual(seen.viewer?.liked, true)
      assert.deepStrictEqual(seen.viewer?.bookmarked, true)
      assert.deepStrictEqual(seen.viewer?.progress?.seen, ["intro"])
      assert.strictEqual((yield* anon.lessons.get({ params: { id: pub.lesson.id } })).viewer, null)
      assert.strictEqual(
        (yield* owner.client.lessons.get({ params: { id: pub.lesson.id } })).viewer?.liked,
        false,
      )

      // Made private: gone from the reader's bookmarks and progress (no title leaks), and every
      // write is a 404 again.
      yield* owner.client.lessons.update({
        params: { id: pub.lesson.id },
        payload: { visibility: "private" },
      })
      assert.deepStrictEqual(yield* bookmarked(), [unl.lesson.id])
      assert.deepStrictEqual(yield* reading(), [unl.lesson.id])
      const listed = JSON.stringify([
        yield* other.client.engagement.bookmarks({ query: {} }),
        yield* other.client.engagement.progress({ query: {} }),
      ])
      assert.notInclude(listed, pub.lesson.title)
      assert.deepStrictEqual(yield* writes(other.client, pub), Array(5).fill("404"))
      // Public again: the bookmark is back (it was hidden, not dropped).
      yield* owner.client.lessons.update({ params: { id: pub.lesson.id }, payload: { visibility: "public" } })
      assert.sameMembers(yield* bookmarked(), [unl.lesson.id, pub.lesson.id])

      // Deleted: gone for good, rows and all.
      yield* owner.client.lessons.delete({ params: { id: unl.lesson.id } })
      assert.deepStrictEqual(yield* bookmarked(), [pub.lesson.id])
      assert.deepStrictEqual(yield* reading(), [pub.lesson.id])
      assert.deepStrictEqual(yield* writes(other.client, unl), Array(5).fill("404"))
    }),
  )

  it.effect("comments and reports follow lesson access", () =>
    Effect.gen(function* () {
      const owner = yield* signIn("Comment Owner")
      const other = yield* signIn("Comment Stranger")
      const anon = yield* anonymous()
      const publish = (slug: string) =>
        owner.client.lessons.publish({ params: { slug }, payload: jsonBytes(tinyLesson("en", slug)) })
      const priv = yield* publish("cmt-private")
      const pub = yield* publish("cmt-public")
      yield* owner.client.lessons.update({
        params: { id: pub.lesson.id },
        payload: { visibility: "public", category_id: "math", tags: ["comments"] },
      })
      const say = (
        client: typeof owner.client,
        target: typeof priv,
        body: string,
        anchor = "section:intro",
      ) =>
        client.comments.create({
          params: { id: target.lesson.id },
          payload: { version_id: target.version.id, anchor, body },
        })

      // The owner talks to themself on the private lesson; nobody else can see or touch it.
      const mine = yield* say(owner.client, priv, "private note")
      const id = priv.lesson.id
      const commentId = mine.id
      const touch = (client: typeof owner.client) =>
        Effect.all([
          outcome(client.comments.list({ params: { id }, query: {} })),
          outcome(say(client, priv, "let me in")),
          outcome(client.comments.update({ params: { id, commentId }, payload: { body: "edited" } })),
          outcome(client.comments.delete({ params: { id, commentId } })),
          outcome(client.comments.hide({ params: { id, commentId } })),
          outcome(client.comments.unhide({ params: { id, commentId } })),
          outcome(
            client.reports.create({ payload: { target_type: "lesson", target_id: id, reason: "spam" } }),
          ),
          outcome(
            client.reports.create({
              payload: { target_type: "comment", target_id: commentId, reason: "spam" },
            }),
          ),
        ])
      assert.deepStrictEqual(yield* touch(other.client), Array(8).fill("404"))
      assert.strictEqual(yield* outcome(anon.comments.list({ params: { id }, query: {} })), "404")
      assert.strictEqual(yield* outcome(say(anon, pub, "anonymous")), "Unauthenticated")
      // A stranger's API token sees the same 404s.
      const token = yield* other.client.tokens.create({ payload: { name: "commenter" } })
      const viaToken = yield* clientWith({ authorization: `Bearer ${token.secret}` })
      assert.deepStrictEqual(yield* touch(viaToken), Array(8).fill("404"))
      const ownList = yield* owner.client.comments.list({ params: { id }, query: {} })
      assert.deepStrictEqual(
        ownList.items.map((item) => item.body),
        ["private note"],
      )
      assert.strictEqual((yield* owner.client.lessons.get({ params: { id } })).comment_count, 1)

      // On the public lesson: a token can comment (pi), a reader replies, the owner hides.
      const fromToken = yield* say(viaToken, pub, "posted by a token")
      assert.strictEqual(fromToken.status, "visible")
      const rude = yield* say(other.client, pub, "rude words here")
      const third = yield* signIn("Comment Third")
      const reply = yield* third.client.comments.create({
        params: { id: pub.lesson.id },
        payload: { version_id: pub.version.id, anchor: "lesson", body: "a fair reply", parent_id: rude.id },
      })
      // A reply takes its parent's anchor.
      assert.strictEqual(reply.anchor, "section:intro")
      // Only the lesson's owner hides (a stranger's try is the 404), and only admins list reports.
      const pubId = pub.lesson.id
      assert.strictEqual(
        yield* outcome(third.client.comments.hide({ params: { id: pubId, commentId: rude.id } })),
        "404",
      )
      yield* owner.client.comments.hide({ params: { id: pubId, commentId: rude.id } })

      const listed = (client: typeof owner.client) =>
        client.comments.list({ params: { id: pubId }, query: {} })
      const threadOf = (page: typeof ownList) => page.items.find((item) => item.id === rude.id)
      // Anonymous and other readers: the thread stays for its reply, with no body and no author.
      for (const client of [anon, third.client]) {
        const page = yield* listed(client)
        const thread = threadOf(page)
        assert.strictEqual(thread?.status, "removed")
        assert.strictEqual(thread?.author_handle, null)
        assert.deepStrictEqual(
          thread?.replies.map((r) => r.body),
          ["a fair reply"],
        )
        assert.notInclude(JSON.stringify(page), "rude words")
      }
      // Its author, the lesson's owner and an admin still see it, marked hidden.
      const admin = yield* signInAdmin()
      for (const client of [other.client, owner.client, admin.client]) {
        const thread = threadOf(yield* listed(client))
        assert.strictEqual(thread?.status, "hidden")
        assert.strictEqual(thread?.body, "rude words here")
        assert.strictEqual(thread?.hidden_by, "owner")
      }
      // Admin powers need the session cookie: the admin's API token reads like any other reader.
      const adminToken = yield* admin.client.tokens.create({ payload: { name: "admin pi" } })
      const adminViaToken = yield* clientWith({ authorization: `Bearer ${adminToken.secret}` })
      const tokenPage = yield* listed(adminViaToken)
      assert.strictEqual(threadOf(tokenPage)?.status, "removed")
      assert.notInclude(JSON.stringify(tokenPage), "rude words")
      assert.isFalse((yield* adminViaToken.me.get()).is_admin)
      // Nobody else can reply to it or report it: to them it is not there.
      assert.strictEqual(
        yield* outcome(
          third.client.comments.create({
            params: { id: pubId },
            payload: { version_id: pub.version.id, anchor: "lesson", body: "more", parent_id: rude.id },
          }),
        ),
        "404",
      )
      assert.strictEqual(
        yield* outcome(
          third.client.reports.create({
            payload: { target_type: "comment", target_id: rude.id, reason: "abuse" },
          }),
        ),
        "404",
      )
      // A hidden comment with no replies is not listed at all for others.
      const lone = yield* say(other.client, pub, "lonely and hidden")
      yield* owner.client.comments.hide({ params: { id: pubId, commentId: lone.id } })
      assert.notInclude(JSON.stringify(yield* listed(anon)), lone.id)
      assert.include(JSON.stringify(yield* listed(other.client)), "lonely and hidden")

      // Edit and delete: the author only.
      assert.strictEqual(
        yield* outcome(
          owner.client.comments.update({
            params: { id: pubId, commentId: reply.id },
            payload: { body: "x" },
          }),
        ),
        "404",
      )
      assert.strictEqual(
        yield* outcome(owner.client.comments.delete({ params: { id: pubId, commentId: reply.id } })),
        "404",
      )

      // Made private: every comment endpoint is the 404 again for everyone but the owner.
      yield* owner.client.lessons.update({ params: { id: pubId }, payload: { visibility: "private" } })
      for (const client of [other.client, third.client, viaToken]) {
        assert.strictEqual(yield* outcome(listed(client)), "404")
        assert.strictEqual(
          yield* outcome(
            client.comments.update({ params: { id: pubId, commentId: rude.id }, payload: { body: "x" } }),
          ),
          "404",
        )
      }
    }),
  )

  it.effect("admin endpoints are a plain 404 for everyone but admins with a session", () =>
    Effect.gen(function* () {
      const user = yield* signIn("Not An Admin")
      const admin = yield* signInAdmin()
      const adminToken = yield* admin.client.tokens.create({ payload: { name: "admin token" } })
      const missing = yield* rawFetch("/api/admin/no-such-route")
      assert.strictEqual(missing.status, 404)
      const missingBody = yield* Effect.promise(() => missing.text())
      const someId = "0190f0f0-0000-7000-8000-000000000000"
      const routes: ReadonlyArray<readonly [string, string]> = [
        ["GET", "/api/admin/reports"],
        ["POST", `/api/admin/reports/${someId}/resolve`],
        ["PUT", `/api/admin/comments/${someId}/hidden`],
        ["DELETE", `/api/admin/comments/${someId}/hidden`],
      ]
      const callers: ReadonlyArray<readonly [string, Record<string, string>]> = [
        ["anonymous", {}],
        ["user", { cookie: user.cookie }],
        ["admin's token", { authorization: `Bearer ${adminToken.secret}` }],
        [
          "admin's token next to the admin's cookie",
          { authorization: `Bearer ${adminToken.secret}`, cookie: admin.cookie },
        ],
      ]
      for (const [method, path] of routes) {
        for (const [name, headers] of callers) {
          const response = yield* rawFetch(path, {
            method,
            headers: { "content-type": "application/json", ...headers },
            body: method === "POST" ? JSON.stringify({ status: "resolved" }) : null,
          })
          assert.strictEqual(response.status, 404, `${name} ${method} ${path}`)
          assert.strictEqual(
            yield* Effect.promise(() => response.text()),
            missingBody,
            `${name} ${method} ${path}`,
          )
        }
      }
      // The admin's session gets through.
      const queue = yield* rawFetch("/api/admin/reports", { headers: { cookie: admin.cookie } })
      assert.strictEqual(queue.status, 200)
      // /api/me says who is an admin, for the web; the server never trusts it back.
      assert.isTrue((yield* admin.client.me.get()).is_admin)
      assert.isFalse((yield* user.client.me.get()).is_admin)
      // Cross-site writes are refused for admins too.
      const crossSite = yield* rawFetch(`/api/admin/comments/${someId}/hidden`, {
        method: "PUT",
        headers: { cookie: admin.cookie, "sec-fetch-site": "cross-site" },
      })
      assert.strictEqual(crossSite.status, 403)
    }),
  )

  it.effect(
    "a lesson made private or deleted during a write gets no like, bookmark, progress or comment",
    () =>
      Effect.gen(function* () {
        const env = yield* TestEnv
        const owner = yield* signIn("Racing Owner")
        const reader = yield* signIn("Racing Reader")
        const readerUser = {
          id: UserId.make(reader.user.id),
          email: reader.user.email,
          name: reader.user.name,
          image: null,
          viaToken: false,
        }
        const publish = (slug: string) =>
          Effect.gen(function* () {
            const published = yield* owner.client.lessons.publish({
              params: { slug },
              payload: jsonBytes(tinyLesson("en", slug)),
            })
            yield* owner.client.lessons.update({
              params: { id: published.lesson.id },
              payload: { visibility: "public", category_id: "math", tags: ["racing"] },
            })
            return {
              id: LessonId.make(published.lesson.id),
              versionId: LessonVersionId.make(published.version.id),
            }
          })
        // A Database that lets the read checks pass, then changes the lesson just before the first
        // write runs: the window between a service's check and its batch.
        const racing = (change: string, id: LessonId) => {
          const pending = { armed: true }
          const first = Effect.suspend(() => {
            if (!pending.armed) return Effect.void
            pending.armed = false
            return Effect.promise(() => env.db.prepare(change).bind(id).run())
          })
          return Layer.effect(
            Database,
            Effect.gen(function* () {
              const inner = yield* Database
              return Database.of({
                ...inner,
                run: (statement) => first.pipe(Effect.andThen(inner.run(statement))),
                batch: (statements) => first.pipe(Effect.andThen(inner.batch(statements))),
              })
            }),
          ).pipe(Layer.provide(Database.layer), Layer.provide(Layer.succeed(D1, env.db)))
        }
        const services = (change: string, id: LessonId) => {
          const database = racing(change, id)
          return Layer.mergeAll(
            Layer.fresh(Engagement.layer).pipe(Layer.provide(database)),
            Layer.fresh(Comments.layer).pipe(Layer.provide(database)),
          )
        }
        const counts = (id: LessonId) =>
          Effect.promise(() =>
            env.db
              .prepare(`select like_count, comment_count,
                (select count(*) from lesson_like where lesson_id = ?1) as likes,
                (select count(*) from bookmark where lesson_id = ?1) as bookmarks,
                (select count(*) from progress where lesson_id = ?1) as progress,
                (select count(*) from comment where lesson_id = ?1) as comments
              from lesson where id = ?1`)
              .bind(id)
              .first(),
          )
        const nothing = { like_count: 0, comment_count: 0, likes: 0, bookmarks: 0, progress: 0, comments: 0 }

        for (const [name, change] of [
          ["made private", "update lesson set visibility = 'private' where id = ?"],
          ["deleted", "update lesson set deleted_at = 1 where id = ?"],
        ] as const) {
          const writes: ReadonlyArray<
            readonly [
              string,
              (target: {
                id: LessonId
                versionId: LessonVersionId
              }) => Effect.Effect<unknown, unknown, Engagement | Comments | CurrentUser>,
            ]
          > = [
            ["like", (target) => Engagement.use((engagement) => engagement.like(target.id))],
            ["bookmark", (target) => Engagement.use((engagement) => engagement.bookmark(target.id))],
            [
              "progress",
              (target) =>
                Engagement.use((engagement) =>
                  engagement.saveProgress(target.id, {
                    version_id: target.versionId,
                    last: null,
                    seen: [],
                    total: 1,
                  }),
                ),
            ],
            [
              "comment",
              (target) =>
                Comments.use((comments) =>
                  comments.create(target.id, {
                    version_id: target.versionId,
                    anchor: "lesson",
                    body: "too late",
                  }),
                ),
            ],
          ]
          for (const [write, run] of writes) {
            const target = yield* publish(`race-${write}-${name.replace(" ", "-")}`)
            const result = yield* run(target).pipe(
              Effect.provide(services(change, target.id)),
              Effect.provideService(CurrentUser, readerUser),
              Effect.result,
            )
            // Like and comment read back after the write, so they answer 404; bookmark and progress
            // answer nothing. Either way nothing was written and no counter moved.
            if (write === "like" || write === "comment") {
              assert.isTrue(result._tag === "Failure", `${write} on a lesson ${name}`)
            }
            assert.deepInclude(yield* counts(target.id), nothing, `${write} on a lesson ${name}`)
          }
        }
      }),
  )

  it.effect("refuses state changes from another site", () =>
    Effect.gen(function* () {
      const owner = yield* signIn("Careful Owner")
      for (const headers of [{ "sec-fetch-site": "cross-site" }, { origin: "https://evil.example" }]) {
        const response = yield* rawFetch("/api/me/lessons/csrf-test/versions", {
          method: "POST",
          headers: { cookie: owner.cookie, "content-type": "application/json", ...headers },
          body: JSON.stringify(tinyLesson("en", "csrf")),
        })
        assert.strictEqual(response.status, 403)
      }
      const mine = yield* owner.client.lessons.mine({ query: {} })
      assert.strictEqual(mine.items.length, 0)
    }),
  )

  // AI generation jobs (ADR 0009): owner only, like private lessons; the draft is private.
  it.effect("another user's generation job is a 404 everywhere, and its draft is private", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      env.model.script = lessonScript
      const owner = yield* signIn("Job Owner")
      const stranger = yield* signIn("Job Stranger")
      const started = yield* owner.client.generations.create({
        payload: {
          prompt: "Why does ice float on water?",
          lang: "en",
          model: "claude-test",
          billing: "platform",
        },
      })
      yield* Effect.promise(() => env.settle(started.id))
      const job = yield* owner.client.generations.get({ params: { id: started.id } })
      assert.strictEqual(job.status, "succeeded")

      const get = yield* stranger.client.generations.get({ params: { id: job.id } }).pipe(Effect.flip)
      assert.strictEqual(get._tag, "GenerationNotFound")
      const cancel = yield* stranger.client.generations.cancel({ params: { id: job.id } }).pipe(Effect.flip)
      assert.strictEqual(cancel._tag, "GenerationNotFound")
      const events = yield* rawFetch(`/api/generations/${job.id}/events`, {
        headers: { cookie: stranger.cookie },
      })
      assert.strictEqual(events.status, 404)
      const missing = yield* rawFetch(`/api/generations/${crypto.randomUUID()}`, {
        headers: { cookie: owner.cookie },
      })
      assert.strictEqual(missing.status, 404)
      const nobody = yield* anonymous()
      assert.strictEqual(
        (yield* nobody.generations.get({ params: { id: job.id } }).pipe(Effect.flip))._tag,
        "Unauthenticated",
      )
      assert.strictEqual((yield* rawFetch(`/api/generations/${job.id}/events`)).status, 401)

      const draft = job.draft
      assert.isNotNull(draft)
      if (draft === null) return
      assert.strictEqual(
        yield* outcome(stranger.client.lessons.get({ params: { id: draft.lesson_id } })),
        "404",
      )
      assert.strictEqual(yield* outcome(nobody.lessons.get({ params: { id: draft.lesson_id } })), "404")
      assert.strictEqual(
        (yield* owner.client.lessons.get({ params: { id: draft.lesson_id } })).visibility,
        "private",
      )
    }),
  )

  it.effect("an API token can read generation jobs but never start or cancel one", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      env.model.script = lessonScript
      const owner = yield* signIn("Token Spender")
      const token = yield* owner.client.tokens.create({ payload: { name: "pi" } })
      const viaToken = yield* clientWith({ authorization: `Bearer ${token.secret}` })
      const payload = {
        prompt: "Why does ice float on water?",
        lang: "en",
        model: "claude-test",
        billing: "platform",
      } as const

      // A job spends money: a leaked token must not start one, on any billing.
      const created = yield* viaToken.generations.create({ payload }).pipe(Effect.flip)
      assert.strictEqual(created._tag, "Unauthenticated")
      const byok = yield* viaToken.generations
        .create({ payload: { ...payload, model: "deepseek-test", billing: "byok" } })
        .pipe(Effect.flip)
      assert.strictEqual(byok._tag, "Unauthenticated")
      assert.strictEqual((yield* owner.client.generations.list({ query: {} })).items.length, 0)

      // The owner's session starts one; the token can read it but not cancel it.
      const started = yield* owner.client.generations.create({ payload })
      yield* Effect.promise(() => env.settle(started.id))
      assert.strictEqual(
        (yield* viaToken.generations.get({ params: { id: started.id } })).status,
        "succeeded",
      )
      assert.deepStrictEqual(
        (yield* viaToken.generations.list({ query: {} })).items.map((item) => item.id),
        [started.id],
      )
      const canceled = yield* viaToken.generations.cancel({ params: { id: started.id } }).pipe(Effect.flip)
      assert.strictEqual(canceled._tag, "Unauthenticated")
    }),
  )
})
