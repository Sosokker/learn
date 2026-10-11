import {
  type ByokKey,
  ByokKeyNotFound,
  type ByokProvider,
  ByokProvider as ByokProviderSchema,
  ByokUnavailable,
  CurrentUser,
  InvalidByokKey,
  Millis,
  type UserId,
} from "@app/api"
import { Database, raw } from "@app/db"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { GenerationSettings } from "./generation-settings.ts"

// Users' own provider keys (BYOK, ADR 0009). Stored AES-GCM encrypted under BYOK_KEK; this service
// only encrypts. The one decryption is `openByokKey`, called by the job runner inside the Durable
// Object (packages/agent), never by an HTTP handler, and the API never returns a key.

export class ByokKeys extends Context.Service<
  ByokKeys,
  {
    readonly list: Effect.Effect<ReadonlyArray<ByokKey>, never, CurrentUser>
    readonly set: (
      provider: ByokProvider,
      key: string,
    ) => Effect.Effect<ByokKey, InvalidByokKey | ByokUnavailable, CurrentUser>
    readonly remove: (provider: ByokProvider) => Effect.Effect<void, ByokKeyNotFound, CurrentUser>
    readonly has: (userId: UserId, provider: ByokProvider) => Effect.Effect<boolean>
  }
>()("@app/services/ByokKeys") {
  static readonly layer = Layer.effect(
    ByokKeys,
    Effect.gen(function* () {
      const db = yield* Database
      const settings = yield* GenerationSettings

      // At most one row per provider (the primary key), so no page.
      const list = Effect.gen(function* () {
        const user = yield* CurrentUser
        return yield* db
          .query(
            raw(
              sql`select provider, last4, created_at from byok_key where user_id = ${user.id} order by provider`,
            ),
            KeyRow,
          )
          .pipe(Effect.orDie)
      }).pipe(Effect.withSpan("ByokKeys.list"))

      const set = Effect.fn("ByokKeys.set")(function* (provider: ByokProvider, key: string) {
        const user = yield* CurrentUser
        const kek = settings.kek
        if (Option.isNone(kek)) return yield* new ByokUnavailable()
        const problem = keyProblem(provider, key)
        if (problem !== undefined) return yield* new InvalidByokKey({ message: problem })
        const sealed = yield* Effect.promise(() => sealByokKey(kek.value, user.id, provider, key))
        const now = Date.now()
        const last4 = key.slice(-4)
        yield* db
          .run(
            raw(sql`insert into byok_key (user_id, provider, ciphertext, iv, last4, created_at, kek_version)
              values (${user.id}, ${provider}, ${sealed.ciphertext}, ${sealed.iv}, ${last4}, ${now}, ${kekVersion})
              on conflict (user_id, provider) do update set ciphertext = excluded.ciphertext, iv = excluded.iv,
                last4 = excluded.last4, created_at = excluded.created_at, kek_version = excluded.kek_version`),
          )
          .pipe(Effect.orDie)
        const stored: ByokKey = { provider, last4, created_at: now }
        return stored
      })

      const remove = Effect.fn("ByokKeys.remove")(function* (provider: ByokProvider) {
        const user = yield* CurrentUser
        const removed = yield* db
          .query(
            raw(
              sql`delete from byok_key where user_id = ${user.id} and provider = ${provider} returning provider`,
            ),
            ProviderRow,
          )
          .pipe(Effect.orDie)
        if (removed.length === 0) return yield* new ByokKeyNotFound()
      })

      const has = Effect.fn("ByokKeys.has")(function* (userId: UserId, provider: ByokProvider) {
        const rows = yield* db
          .query(
            raw(sql`select provider from byok_key where user_id = ${userId} and provider = ${provider}`),
            ProviderRow,
          )
          .pipe(Effect.orDie)
        return rows.length > 0
      })

      return ByokKeys.of({ list, set, remove, has })
    }),
  )
}

// What a provider's API keys look like. No request to the provider: a wrong key fails the job
// with the provider's 401, which the job shows.
const keyPatterns: Readonly<Record<ByokProvider, RegExp>> = {
  // Console API keys (sk-ant-api03-…). OAuth tokens (sk-ant-oat…) are refused.
  anthropic: /^sk-ant-api\d{2}-[A-Za-z0-9_-]+$/u,
  openai: /^sk-[A-Za-z0-9_-]+$/u,
  deepseek: /^sk-[A-Za-z0-9]+$/u,
}

const keyProblem = (provider: ByokProvider, key: string): string | undefined =>
  keyPatterns[provider].test(key) ? undefined : `this does not look like a ${provider} API key`

// The additional data binds a ciphertext to its row: copied to another user or provider, it does
// not decrypt.
const additionalData = (userId: string, provider: ByokProvider) =>
  new TextEncoder().encode(`${userId}:${provider}`)

export async function sealByokKey(kek: CryptoKey, userId: string, provider: ByokProvider, key: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(userId, provider) },
    kek,
    new TextEncoder().encode(key),
  )
  return { ciphertext: toBase64(new Uint8Array(ciphertext)), iv: toBase64(iv) }
}

// The job runner's decryption (inside the Durable Object). Rejects when the row was tampered with
// or belongs to another user or provider.
export async function openByokKey(
  kek: CryptoKey,
  userId: string,
  provider: ByokProvider,
  sealed: { readonly ciphertext: string; readonly iv: string },
) {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(sealed.iv), additionalData: additionalData(userId, provider) },
    kek,
    fromBase64(sealed.ciphertext),
  )
  return new TextDecoder().decode(plain)
}

export const SealedKeyRow = Schema.Struct({
  ciphertext: Schema.String,
  iv: Schema.String,
  kek_version: Schema.Int,
})

// The version of BYOK_KEK that seals new keys. Rotation (README): add the new key as a new
// version, re-seal or drop the rows of the old one, then remove the old key.
export const kekVersion = 1

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0))

const KeyRow = Schema.Struct({ provider: ByokProviderSchema, last4: Schema.String, created_at: Millis })
const ProviderRow = Schema.Struct({ provider: Schema.String })
