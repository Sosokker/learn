import { assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import { anonymous, clientWith, jsonBytes, rawFetch, signIn, TestLayer, tinyLesson } from "./support.ts"

// The external agent contract (Claude Code, OpenCode, Codex, pi): a public schema, a dry run that
// shares publish's rules, and the existing token + publish path.

layer(TestLayer, { excludeTestServices: true })("agent contract", (it) => {
  it.effect("validates an en/th bundle without writing", () =>
    Effect.gen(function* () {
      const author = yield* signIn("Agent Author")
      const result = yield* author.client.lessons.validate({
        params: { slug: "agent-pair" },
        payload: jsonBytes({
          specs: [tinyLesson("en", "pair"), tinyLesson("th", "คู่")],
        }),
      })
      assert.isTrue(result.valid)
      assert.deepStrictEqual(result.issues, [])
      assert.strictEqual((yield* author.client.lessons.mine({ query: {} })).items.length, 0)
    }),
  )

  it.effect("reports broken references, parity and duplicate languages as issues, not errors", () =>
    Effect.gen(function* () {
      const author = yield* signIn("Agent Checker")
      const validate = (slug: string, specs: ReadonlyArray<unknown>) =>
        author.client.lessons.validate({ params: { slug }, payload: jsonBytes({ specs }) })

      const dangling = yield* validate("dangling", [
        tinyLesson("en", "dangling", {
          sections: [{ id: "intro", type: "text", body: "See [nope:this]." }],
        }),
      ])
      assert.isFalse(dangling.valid)
      assert.include(
        dangling.issues.map((issue) => issue.code),
        "unknown_part",
      )
      assert.isTrue(dangling.issues.every((issue) => issue.path.startsWith("specs[0].")))

      const parity = yield* validate("parity", [
        tinyLesson("en", "parity"),
        tinyLesson("th", "ความเท่าเทียม", {
          sections: [{ id: "other", type: "text", body: "ดู [x:$x$]" }],
        }),
      ])
      assert.isFalse(parity.valid)
      assert.include(
        parity.issues.map((issue) => issue.code),
        "parity",
      )

      const duplicate = yield* validate("duplicate", [tinyLesson("en", "one"), tinyLesson("en", "two")])
      assert.isFalse(duplicate.valid)
      assert.include(
        duplicate.issues.map((issue) => issue.code),
        "duplicate",
      )

      // The same checks apply to a lesson that already has a published language.
      yield* author.client.lessons.publish({
        params: { slug: "published" },
        payload: jsonBytes(tinyLesson("en", "published")),
      })
      const mismatch = yield* validate("published", [
        tinyLesson("th", "เผยแพร่", {
          sections: [{ id: "other", type: "text", body: "ดู [x:$x$]" }],
        }),
      ])
      assert.isFalse(mismatch.valid)
      assert.include(
        mismatch.issues.map((issue) => issue.code),
        "parity",
      )
      const matching = yield* validate("published", [tinyLesson("th", "เผยแพร่")])
      assert.isTrue(matching.valid)
    }),
  )

  it.effect("publishes an en/th bundle with one token call", () =>
    Effect.gen(function* () {
      const author = yield* signIn("Agent Publisher")
      const created = yield* author.client.tokens.create({ payload: { name: "claude code" } })
      const agent = yield* clientWith({ authorization: `Bearer ${created.secret}` })
      const published = yield* agent.lessons.publishBundle({
        params: { slug: "agent-published" },
        payload: jsonBytes({ specs: [tinyLesson("en", "agent"), tinyLesson("th", "ตัวแทน")] }),
      })
      assert.isTrue(published.created)
      assert.deepStrictEqual(
        published.versions.map((entry) => `${entry.version.lang}${entry.version.n}:${entry.created}`),
        ["en1:true", "th1:true"],
      )
      assert.strictEqual(published.lesson.langs.length, 2)
      assert.strictEqual((yield* author.client.lessons.mine({ query: {} })).items.length, 1)
    }),
  )

  it.effect("accepts a token and serves the schema without auth", () =>
    Effect.gen(function* () {
      const author = yield* signIn("Agent Token")
      const created = yield* author.client.tokens.create({ payload: { name: "claude code" } })
      const agent = yield* clientWith({ authorization: `Bearer ${created.secret}` })
      const result = yield* agent.lessons.validate({
        params: { slug: "from-agent" },
        payload: jsonBytes({ specs: [tinyLesson("en", "from-agent")] }),
      })
      assert.isTrue(result.valid)

      const schemaResponse = yield* rawFetch("/api/agent/lesson-schema")
      assert.strictEqual(schemaResponse.status, 200)
      assert.include(schemaResponse.headers.get("content-type") ?? "", "application/schema+json")
      assert.strictEqual(schemaResponse.headers.get("cache-control"), "public, max-age=3600")
      const schema = JSON.parse(yield* Effect.promise(() => schemaResponse.text())) as {
        readonly $schema: string
        readonly type: string
        readonly properties: { readonly kind: { readonly enum: ReadonlyArray<string> } }
      }
      assert.strictEqual(schema.$schema, "https://json-schema.org/draft/2020-12/schema")
      assert.strictEqual(schema.type, "object")
      assert.include(schema.properties.kind.enum, "learn")

      const anon = yield* anonymous()
      const refusal = yield* anon.lessons
        .validate({
          params: { slug: "from-agent" },
          payload: jsonBytes({ specs: [tinyLesson("en", "x")] }),
        })
        .pipe(Effect.flip)
      assert.strictEqual(refusal._tag, "Unauthenticated")

      // The publish body limit applies before decoding.
      const huge = yield* rawFetch("/api/me/lessons/huge/validate", {
        method: "POST",
        headers: { cookie: author.cookie, "content-type": "application/json" },
        body: JSON.stringify({ specs: [tinyLesson("en", "huge")], pad: "x".repeat(512 * 1024) }),
      })
      assert.strictEqual(huge.status, 413)
    }),
  )
})
