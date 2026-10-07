import { CurrentUser, platformUserId } from "@app/api"
import { Concepts } from "@app/services"
import { assert, layer } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { StorageR2 } from "../src/storage-r2.ts"
import {
  anonymous,
  jsonBytes,
  rawFetch,
  readContent,
  signIn,
  TestEnv,
  TestLayer,
  tinyLesson,
} from "./support.ts"

const platformUser = { id: platformUserId, name: "Learn", email: "learn@users.invalid", image: null }

// "ok", "404" for LessonNotFound, or the tag of any other failure (which fails the assertion).
const outcome = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.map(() => "ok"),
    Effect.catch((error) => Effect.succeed(error._tag === "LessonNotFound" ? "404" : error._tag)),
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
        // The concept bundle of a version never changes: public and unlisted ones are cacheable
        // like /c/, a private one never is.
        const bundle = yield* rawFetch(
          `/api/lessons/${c.published.lesson.id}/versions/${c.published.version.id}/concepts`,
          { headers: { cookie: owner.cookie } },
        )
        assert.strictEqual(bundle.status, 200, `bundle for ${c.name}`)
        assert.strictEqual(
          bundle.headers.get("cache-control"),
          c.everyone ? "public, max-age=31536000, immutable" : "private, no-store",
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
})
