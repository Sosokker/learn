import { apiTokenPattern, maxApiTokens } from "@app/api"
import { lastUsedEvery } from "@app/auth"
import { assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import { clientWith, jsonBytes, rawFetch, signIn, TestEnv, TestLayer, tinyLesson } from "./support.ts"

// API tokens (ADR 0008): bearer auth for pi's publish, managed with the session cookie only.

const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` })

const lastUsed = (id: string) =>
  Effect.gen(function* () {
    const env = yield* TestEnv
    const row = yield* Effect.promise(() =>
      env.db
        .prepare("select last_used_at from api_token where id = ?")
        .bind(id)
        .first<{ last_used_at: number | null }>(),
    )
    return row?.last_used_at ?? null
  })

const setLastUsed = (id: string, at: number) =>
  Effect.gen(function* () {
    const env = yield* TestEnv
    yield* Effect.promise(() =>
      env.db.prepare("update api_token set last_used_at = ? where id = ?").bind(at, id).run(),
    )
  })

const publishRaw = (headers: Record<string, string>, slug: string) =>
  rawFetch(`/api/me/lessons/${slug}/versions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(tinyLesson("en", slug)),
  })

layer(TestLayer, { excludeTestServices: true })("api tokens", (it) => {
  it.effect("a token publishes as its owner and reads back the private lesson", () =>
    Effect.gen(function* () {
      const owner = yield* signIn("Token Owner")
      const created = yield* owner.client.tokens.create({ payload: { name: "pi on laptop" } })
      assert.match(created.secret, apiTokenPattern)
      assert.strictEqual(created.token.prefix, created.secret.slice(0, 10))
      assert.isNull(created.token.last_used_at)

      const pi = yield* clientWith(bearer(created.secret))
      const published = yield* pi.lessons.publish({
        params: { slug: "from-pi" },
        payload: jsonBytes(tinyLesson("en", "from-pi")),
      })
      assert.strictEqual(published.lesson.visibility, "private")
      const mine = yield* owner.client.lessons.mine({ query: {} })
      assert.deepStrictEqual(
        mine.items.map((item) => item.id),
        [published.lesson.id],
      )

      // Viewer reads accept the token too, so pi can check what it published.
      const body = yield* pi.lessons.body({
        params: { id: published.lesson.id, versionId: published.version.id },
      })
      assert.strictEqual(body.title, published.lesson.title)
      assert.isTrue((yield* pi.lessons.get({ params: { id: published.lesson.id } })).is_owner)
      assert.strictEqual((yield* pi.me.get()).id, owner.user.id)

      // The list shows the name and prefix, never the secret or its hash.
      const listed = yield* owner.client.tokens.list()
      assert.strictEqual(listed.length, 1)
      assert.strictEqual(listed[0]?.name, "pi on laptop")
      assert.strictEqual(listed[0]?.prefix, created.token.prefix)
      assert.isNumber(listed[0]?.last_used_at)
      assert.notInclude(JSON.stringify(listed), created.secret)

      // The create answer holds the secret, so it is never cached.
      const raw = yield* rawFetch("/api/me/tokens", {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({ name: "second" }),
      })
      assert.strictEqual(raw.status, 201)
      assert.strictEqual(raw.headers.get("cache-control"), "no-store")
    }),
  )

  it.effect("revoked, unknown and malformed tokens get the same 401", () =>
    Effect.gen(function* () {
      const owner = yield* signIn("Revoking Owner")
      const other = yield* signIn("Other Revoker")
      const created = yield* owner.client.tokens.create({ payload: { name: "old" } })
      const pi = yield* clientWith(bearer(created.secret))

      // Someone else's token id looks like a missing one, and the token keeps working.
      const foreign = yield* other.client.tokens
        .revoke({ params: { id: created.token.id } })
        .pipe(Effect.flip)
      assert.strictEqual(foreign._tag, "ApiTokenNotFound")
      yield* pi.lessons.mine({ query: {} })

      yield* owner.client.tokens.revoke({ params: { id: created.token.id } })
      const revoked = yield* pi.lessons
        .publish({ params: { slug: "after-revoke" }, payload: jsonBytes(tinyLesson("en", "after-revoke")) })
        .pipe(Effect.flip)
      assert.strictEqual(revoked._tag, "Unauthenticated")
      const again = yield* owner.client.tokens.revoke({ params: { id: created.token.id } }).pipe(Effect.flip)
      assert.strictEqual(again._tag, "ApiTokenNotFound")
      assert.strictEqual((yield* owner.client.tokens.list()).length, 0)

      const unknown = `lrn_${"A".repeat(43)}`
      for (const authorization of [`Bearer ${unknown}`, "Bearer nonsense", "Basic dXNlcjpwYXNz", "Bearer"]) {
        const response = yield* publishRaw({ authorization }, "bad-token")
        assert.strictEqual(response.status, 401, authorization)
      }
      // On public reads a bad token reads as anonymous, like a broken cookie.
      const feed = yield* rawFetch("/api/feeds/new", { headers: bearer(unknown) })
      assert.strictEqual(feed.status, 200)
    }),
  )

  it.effect("a token is the only credential looked at when an Authorization header is sent", () =>
    Effect.gen(function* () {
      const owner = yield* signIn("Both Credentials")
      // A valid cookie does not rescue a bad token.
      const bad = yield* publishRaw({ cookie: owner.cookie, authorization: "Bearer lrn_wrong" }, "mixed")
      assert.strictEqual(bad.status, 401)
      assert.strictEqual((yield* owner.client.lessons.mine({ query: {} })).items.length, 0)
    }),
  )

  it.effect("a token cannot list, create or revoke tokens", () =>
    Effect.gen(function* () {
      const owner = yield* signIn("Careful Token Owner")
      const created = yield* owner.client.tokens.create({ payload: { name: "pi" } })
      const pi = yield* clientWith(bearer(created.secret))
      // Not even with the owner's cookie alongside.
      const both = yield* clientWith({ ...bearer(created.secret), cookie: owner.cookie })
      for (const client of [pi, both]) {
        assert.strictEqual((yield* client.tokens.list().pipe(Effect.flip))._tag, "Unauthenticated")
        const create = yield* client.tokens.create({ payload: { name: "minted" } }).pipe(Effect.flip)
        assert.strictEqual(create._tag, "Unauthenticated")
        const revoke = yield* client.tokens.revoke({ params: { id: created.token.id } }).pipe(Effect.flip)
        assert.strictEqual(revoke._tag, "Unauthenticated")
      }
      assert.strictEqual((yield* owner.client.tokens.list()).length, 1)
    }),
  )

  it.effect("skips the cross-site check for tokens but keeps it for cookies", () =>
    Effect.gen(function* () {
      const owner = yield* signIn("Cross Site Owner")
      const created = yield* owner.client.tokens.create({ payload: { name: "pi" } })
      const foreign = { origin: "https://evil.example", "sec-fetch-site": "cross-site" }

      const viaCookie = yield* publishRaw({ cookie: owner.cookie, ...foreign }, "cookie-xsite")
      assert.strictEqual(viaCookie.status, 403)
      const viaToken = yield* publishRaw({ ...bearer(created.secret), ...foreign }, "token-xsite")
      assert.strictEqual(viaToken.status, 201)

      // Token management is cookie only, so it keeps the check.
      const mint = yield* rawFetch("/api/me/tokens", {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json", ...foreign },
        body: JSON.stringify({ name: "from evil" }),
      })
      assert.strictEqual(mint.status, 403)
      assert.strictEqual((yield* owner.client.tokens.list()).length, 1)
    }),
  )

  it.effect("token writes share the user's write rate limit", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const owner = yield* signIn("Limited Token Owner")
      const created = yield* owner.client.tokens.create({ payload: { name: "pi" } })
      env.limitWrites(owner.user.id, 0)
      const limited = yield* publishRaw(bearer(created.secret), "limited")
      assert.strictEqual(limited.status, 429)
    }),
  )

  it.effect("caps active tokens per user", () =>
    Effect.gen(function* () {
      const owner = yield* signIn("Many Tokens")
      const other = yield* signIn("Few Tokens")
      const made = yield* Effect.forEach(
        Array.from({ length: maxApiTokens }, (_, index) => index),
        (index) => owner.client.tokens.create({ payload: { name: `token ${index}` } }),
      )
      const over = yield* owner.client.tokens.create({ payload: { name: "one more" } }).pipe(Effect.flip)
      assert.strictEqual(over._tag, "ApiTokenLimit")
      // The cap is per user.
      yield* other.client.tokens.create({ payload: { name: "mine" } })
      // A revoked token frees a slot; the list shows active tokens only, newest first.
      const first = made[0]
      if (first === undefined) return assert.fail("no tokens made")
      yield* owner.client.tokens.revoke({ params: { id: first.token.id } })
      const replacement = yield* owner.client.tokens.create({ payload: { name: "replacement" } })
      const listed = yield* owner.client.tokens.list()
      assert.strictEqual(listed.length, maxApiTokens)
      assert.strictEqual(listed[0]?.id, replacement.token.id)
      assert.notInclude(
        listed.map((token) => token.id),
        first.token.id,
      )

      const blank = yield* rawFetch("/api/me/tokens", {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({ name: "  padded  " }),
      })
      assert.strictEqual(blank.status, 400)
    }),
  )

  it.effect("updates last_used_at at most every few minutes", () =>
    Effect.gen(function* () {
      const owner = yield* signIn("Last Used Owner")
      const created = yield* owner.client.tokens.create({ payload: { name: "pi" } })
      const pi = yield* clientWith(bearer(created.secret))
      const id = created.token.id

      yield* pi.lessons.mine({ query: {} })
      const first = yield* lastUsed(id)
      assert.isNotNull(first)

      // Recently used: a second request writes nothing.
      const recent = Date.now() - 60_000
      yield* setLastUsed(id, recent)
      yield* pi.lessons.mine({ query: {} })
      assert.strictEqual(yield* lastUsed(id), recent)

      // Older than the interval: rewritten.
      const stale = Date.now() - lastUsedEvery - 1
      yield* setLastUsed(id, stale)
      yield* pi.lessons.mine({ query: {} })
      assert.isAbove((yield* lastUsed(id)) ?? 0, stale)
    }),
  )
})
