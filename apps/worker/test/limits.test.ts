import { maxCards, maxConceptNeeds } from "@app/domain"
import { assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import { jsonBytes, rawFetch, readContent, signIn, TestEnv, TestLayer, tinyLesson } from "./support.ts"

// Abuse limits: the per-user write rate limit, and the caps that keep every `in (…)` lookup under
// D1's 100 bound parameters (over the cap is a 422, never a 500).
layer(TestLayer, { excludeTestServices: true })("limits", (it) => {
  it.effect("limits state-changing requests per user with a typed 429", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const busy = yield* signIn("Busy Writer")
      const calm = yield* signIn("Calm Writer")
      env.limitWrites(busy.user.id, 2)

      const publish = (client: typeof busy.client, slug: string) =>
        client.lessons.publish({ params: { slug }, payload: jsonBytes(tinyLesson("en", slug)) })
      const first = yield* publish(busy.client, "one")
      yield* busy.client.lessons.update({
        params: { id: first.lesson.id },
        payload: { visibility: "unlisted" },
      })

      const third = yield* publish(busy.client, "three").pipe(Effect.flip)
      assert.strictEqual(third._tag, "RateLimited")
      const remove = yield* busy.client.lessons.delete({ params: { id: first.lesson.id } }).pipe(Effect.flip)
      assert.strictEqual(remove._tag, "RateLimited")
      const handle = yield* busy.client.me.update({ payload: { handle: "busy_w" } }).pipe(Effect.flip)
      assert.strictEqual(handle._tag, "RateLimited")
      const concept = yield* busy.client.concepts
        .publish({ payload: jsonBytes(readContent("concepts/physics.total-time/en.json")) })
        .pipe(Effect.flip)
      assert.strictEqual(concept._tag, "RateLimited")
      const raw = yield* rawFetch("/api/me", {
        method: "PATCH",
        headers: { cookie: busy.cookie, "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ handle: "busy_w" }),
      })
      assert.strictEqual(raw.status, 429)

      // Reads are not limited, and the limit is per user.
      assert.strictEqual((yield* busy.client.lessons.mine({ query: {} })).items.length, 1)
      yield* publish(calm.client, "calm")
    }),
  )

  it.effect("caps concept cards per lesson and needs per concept", () =>
    Effect.gen(function* () {
      const author = yield* signIn("Cap Author")
      const refs = (count: number) =>
        Object.fromEntries(
          Array.from({ length: count }, (_, index) => [`c${index}`, { concept: `test.unknown-${index}` }]),
        )

      // At the cap, every slug is looked up in one statement: a 422 for the unknown concepts.
      const atCap = yield* author.client.lessons
        .publish({
          params: { slug: "at-cap" },
          payload: jsonBytes(tinyLesson("en", "at-cap", { cards: refs(maxCards) })),
        })
        .pipe(Effect.flip)
      assert.strictEqual(atCap._tag, "InvalidLesson")
      if (atCap._tag === "InvalidLesson") assert.isTrue(atCap.issues.some((issue) => issue.code !== "schema"))

      const overCap = yield* author.client.lessons
        .publish({
          params: { slug: "over-cap" },
          payload: jsonBytes(tinyLesson("en", "over-cap", { cards: refs(maxCards + 1) })),
        })
        .pipe(Effect.flip)
      assert.strictEqual(overCap._tag, "InvalidLesson")
      if (overCap._tag === "InvalidLesson") assert.strictEqual(overCap.issues[0]?.code, "schema")

      const base = readContent("concepts/physics.total-time/en.json")
      const needs = (count: number) => Array.from({ length: count }, (_, index) => `test.need-${index}`)
      const conceptWith = (slug: string, count: number) =>
        author.client.concepts
          .publish({ payload: jsonBytes(Object.assign({}, base, { slug, needs: needs(count) })) })
          .pipe(Effect.flip)
      const needsAtCap = yield* conceptWith("test.at-cap", maxConceptNeeds)
      assert.strictEqual(needsAtCap._tag, "InvalidConcept")
      if (needsAtCap._tag === "InvalidConcept")
        assert.isTrue(needsAtCap.issues.some((issue) => issue.code === "unknown_concept"))
      const needsOverCap = yield* conceptWith("test.over-cap", maxConceptNeeds + 1)
      assert.strictEqual(needsOverCap._tag, "InvalidConcept")
      if (needsOverCap._tag === "InvalidConcept") assert.strictEqual(needsOverCap.issues[0]?.code, "schema")
    }),
  )
})
