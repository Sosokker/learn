import {
  type ApiToken,
  type ApiTokenCreated,
  ApiTokenId,
  ApiTokenLimit,
  ApiTokenNotFound,
  apiTokenPattern,
  CurrentUser,
  Millis,
  maxApiTokens,
  UserId,
} from "@app/api"
import { Database, raw, uuidv7 } from "@app/db"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"

// API tokens (ADR 0008): bearer credentials for pi and scripts/publish.ts. Lives here, not in
// packages/services, because verifying a token reads the Better Auth `user` row.

// A token's last_used_at is rewritten at most this often, so a burst of publishes costs one write.
export const lastUsedEvery = 5 * 60 * 1000

// Shown in the settings list so tokens can be told apart: `lrn_` and 6 of the 43 random
// characters (36 of 256 bits; the rest stay secret).
const prefixLength = 10

export class ApiTokens extends Context.Service<
  ApiTokens,
  {
    readonly list: Effect.Effect<ReadonlyArray<ApiToken>, never, CurrentUser>
    readonly create: (name: string) => Effect.Effect<ApiTokenCreated, ApiTokenLimit, CurrentUser>
    // Owner only: another user's token is the same 404 as a missing or already revoked one.
    readonly revoke: (id: ApiTokenId) => Effect.Effect<void, ApiTokenNotFound, CurrentUser>
    // The user a bearer token acts for; none for a malformed, unknown or revoked token.
    readonly verify: (token: string) => Effect.Effect<Option.Option<CurrentUser["Service"]>>
  }
>()("@app/auth/ApiTokens") {
  // D1 failures are unexpected here; they become defects (HTTP 500).
  static readonly layer = Layer.effect(
    ApiTokens,
    Effect.gen(function* () {
      const db = yield* Database

      const list = Effect.gen(function* () {
        const user = yield* CurrentUser
        // Bounded by the cap, so no keyset page: at most maxApiTokens rows of api_token_active_idx.
        return yield* db
          .query(
            raw(sql`select id, name, prefix, created_at, last_used_at from api_token
              where user_id = ${user.id} and revoked_at is null
              order by created_at desc, id desc limit ${maxApiTokens}`),
            TokenRow,
          )
          .pipe(Effect.orDie)
      }).pipe(Effect.withSpan("ApiTokens.list"))

      const create = Effect.fn("ApiTokens.create")(function* (name: string) {
        const user = yield* CurrentUser
        const secret = newToken()
        const now = Date.now()
        const id = uuidv7(now)
        const prefix = secret.slice(0, prefixLength)
        const hash = yield* sha256Hex(secret)
        // The cap and the insert in one statement, so two racing creates cannot both pass it.
        // count(*) is fine here: at most maxApiTokens rows of api_token_active_idx (ADR 0008).
        const inserted = yield* db
          .query(
            raw(sql`insert into api_token (id, user_id, hash, name, prefix, created_at)
              select ${id}, ${user.id}, ${hash}, ${name}, ${prefix}, ${now}
              where (select count(*) from api_token where user_id = ${user.id} and revoked_at is null)
                < ${maxApiTokens}
              returning id`),
            IdRow,
          )
          .pipe(Effect.orDie)
        const row = inserted[0]
        if (row === undefined) return yield* new ApiTokenLimit({ max: maxApiTokens })
        const created: ApiTokenCreated = {
          token: { id: row.id, name, prefix, created_at: now, last_used_at: null },
          secret,
        }
        return created
      })

      const revoke = Effect.fn("ApiTokens.revoke")(function* (id: ApiTokenId) {
        const user = yield* CurrentUser
        const revoked = yield* db
          .query(
            raw(sql`update api_token set revoked_at = ${Date.now()}
              where id = ${id} and user_id = ${user.id} and revoked_at is null returning id`),
            IdRow,
          )
          .pipe(Effect.orDie)
        if (revoked.length === 0) return yield* new ApiTokenNotFound()
      })

      const verify = Effect.fn("ApiTokens.verify")(function* (token: string) {
        if (!apiTokenPattern.test(token)) return Option.none()
        const hash = yield* sha256Hex(token)
        // The lookup is by hash (unique index), so comparing secrets never happens in JS.
        const rows = yield* db
          .query(
            raw(sql`select t.id, t.last_used_at, u.id as user_id, u.email, u.name, u.image
              from api_token t join user u on u.id = t.user_id
              where t.hash = ${hash} and t.revoked_at is null limit 1`),
            OwnerRow,
          )
          .pipe(Effect.orDie)
        const row = rows[0]
        if (row === undefined) return Option.none()
        const now = Date.now()
        if (row.last_used_at === null || now - row.last_used_at >= lastUsedEvery) {
          yield* db
            .run(raw(sql`update api_token set last_used_at = ${now} where id = ${row.id}`))
            .pipe(Effect.orDie)
        }
        return Option.some({
          id: row.user_id,
          email: row.email,
          name: row.name,
          image: row.image,
          viaToken: true,
        })
      })

      return ApiTokens.of({ list, create, revoke, verify })
    }),
  )
}

// `lrn_` + 32 random bytes, base64url without padding.
const newToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const base64 = btoa(String.fromCharCode(...bytes))
  return `lrn_${base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "")}`
}

const sha256Hex = (text: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).pipe(
    Effect.map((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    ),
  )

const TokenRow = Schema.Struct({
  id: ApiTokenId,
  name: Schema.String,
  prefix: Schema.String,
  created_at: Millis,
  last_used_at: Schema.NullOr(Millis),
})
const IdRow = Schema.Struct({ id: ApiTokenId })
const OwnerRow = Schema.Struct({
  id: ApiTokenId,
  last_used_at: Schema.NullOr(Millis),
  user_id: UserId,
  email: Schema.String,
  name: Schema.String,
  image: Schema.NullOr(Schema.String),
})
