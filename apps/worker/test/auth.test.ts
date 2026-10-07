import { Auth, handleBase } from "@app/auth"
import { checkAuthSchema } from "@app/auth/testing"
import { assert, layer } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { anonymous, rawFetch, signIn, TestEnv, TestLayer } from "./support.ts"

layer(TestLayer, { excludeTestServices: true })("auth", (it) => {
  it.effect("the migrated schema is what Better Auth expects", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      yield* Effect.promise(() => checkAuthSchema(env.db))
    }),
  )

  it.effect("gives every new user a profile with a unique handle", () =>
    Effect.gen(function* () {
      const first = yield* signIn("Grace Hopper")
      const second = yield* signIn("Grace Hopper")
      const thai = yield* signIn("สมชาย ใจดี", `somchai.j${crypto.randomUUID().slice(0, 4)}@example.com`)
      const reserved = yield* signIn("Learn", "learn@example.com")

      const handles = yield* Effect.forEach([first, second, thai, reserved], (user) =>
        user.client.me.get().pipe(Effect.map((me) => me.handle)),
      )
      assert.strictEqual(handles[0], "grace_hopper")
      assert.match(handles[1] ?? "", /^grace_hopper_\d{4}$/)
      // No Latin letters in the name: a random handle, never the email's local part.
      assert.match(handles[2] ?? "", /^user_[a-z2-7]{6}$/)
      // `learn` is the platform account's handle.
      assert.strictEqual(handles[3], "learn_1")

      const me = yield* first.client.me.get()
      assert.strictEqual(me.name, "Grace Hopper")
      assert.strictEqual(me.lesson_count, 0)

      // The hook is idempotent: a second sign-in does not make another profile.
      const auth = yield* Auth
      const env = yield* TestEnv
      yield* auth.use(async (instance) => {
        const context = await instance.$context
        await context.internalAdapter.createSession(first.user.id)
      })
      const profiles = yield* Effect.promise(() =>
        env.db
          .prepare("select count(*) as n from profile where user_id = ?")
          .bind(first.user.id)
          .first<{ n: number }>(),
      )
      assert.strictEqual(profiles?.n, 1)
    }),
  )

  it.effect("only Google sign-in is offered", () =>
    Effect.gen(function* () {
      const anon = yield* anonymous()
      const me = yield* anon.me.get().pipe(Effect.flip)
      assert.strictEqual(me._tag, "Unauthenticated")

      const google = yield* rawFetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ provider: "google", callbackURL: "/" }),
      })
      assert.strictEqual(google.status, 200)
      const redirect = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }))(
        yield* Effect.promise(() => google.json()),
      )
      assert.match(redirect.url, /^https:\/\/accounts\.google\.com\//)

      const password = yield* rawFetch("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ email: "x@example.com", password: "correct horse battery", name: "X" }),
      })
      assert.isTrue(password.status >= 400)
    }),
  )

  it("derives handles from the Latin letters of the name, never from the email", () => {
    assert.strictEqual(handleBase("Ada Lovelace"), "ada_lovelace")
    assert.strictEqual(handleBase("José Ñúñez"), "jose_nunez")
    assert.match(handleBase("ก"), /^user_[a-z2-7]{6}$/)
    assert.match(handleBase("สมชาย ใจดี"), /^user_[a-z2-7]{6}$/)
    assert.strictEqual(handleBase("Admin"), "admin_1")
    assert.strictEqual(handleBase("A very long name that keeps going"), "a_very_long_name_tha")
  })

  it.effect("lets a user change their handle, but not to a taken or reserved one", () =>
    Effect.gen(function* () {
      const ada = yield* signIn("Ada Handle")
      const bob = yield* signIn("Bob Handle")
      const changed = yield* ada.client.me.update({ payload: { handle: "ada_l" } })
      assert.strictEqual(changed.handle, "ada_l")
      assert.strictEqual((yield* ada.client.me.get()).handle, "ada_l")
      // Setting the same handle again is fine.
      assert.strictEqual((yield* ada.client.me.update({ payload: { handle: "ada_l" } })).handle, "ada_l")

      const taken = yield* bob.client.me.update({ payload: { handle: "ada_l" } }).pipe(Effect.flip)
      assert.strictEqual(taken._tag, "HandleTaken")
      for (const handle of ["learn", "admin", "api", "www"]) {
        const reserved = yield* bob.client.me.update({ payload: { handle } }).pipe(Effect.flip)
        assert.strictEqual(reserved._tag, "InvalidHandle", handle)
      }
      for (const handle of ["A", "Ada", "-ada", "a", "a".repeat(31), "ada.l"]) {
        const response = yield* rawFetch("/api/me", {
          method: "PATCH",
          headers: {
            cookie: bob.cookie,
            "content-type": "application/json",
            origin: "http://localhost:3000",
          },
          body: JSON.stringify({ handle }),
        })
        assert.strictEqual(response.status, 400, handle)
      }
      const anon = yield* anonymous()
      const anonymousChange = yield* anon.me.update({ payload: { handle: "anon_x" } }).pipe(Effect.flip)
      assert.strictEqual(anonymousChange._tag, "Unauthenticated")
    }),
  )

  it.effect("the platform user can never get a session or a linked Google account", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const auth = yield* Auth
      yield* Effect.promise(() =>
        env.db
          .prepare(
            `insert into "user" (id, name, email, email_verified, image, created_at, updated_at)
            values ('learn', 'Learn', 'learn@users.invalid', 0, null, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
          )
          .run(),
      )
      const outcome = yield* auth.use(async (instance) => {
        const context = await instance.$context
        const session = await context.internalAdapter.createSession("learn").catch(() => null)
        const account = await context.internalAdapter
          .linkAccount({ userId: "learn", providerId: "google", accountId: "google-sub-1" })
          .catch(() => null)
        return {
          session,
          account,
          linking: context.options.account?.accountLinking?.enabled,
          encrypted: context.options.account?.encryptOAuthTokens,
        }
      })
      assert.isNull(outcome.session)
      assert.isNull(outcome.account)
      assert.strictEqual(outcome.linking, false)
      assert.strictEqual(outcome.encrypted, true)
      const rows = yield* Effect.promise(() =>
        env.db
          .prepare(
            "select (select count(*) from session where user_id = 'learn') + (select count(*) from account where user_id = 'learn') as n",
          )
          .first<{ n: number }>(),
      )
      assert.strictEqual(rows?.n, 0)
    }),
  )
})
