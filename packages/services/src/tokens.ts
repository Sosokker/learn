import { apiToken, Db, newApiToken, sha256Hex, uuidv7 } from "@app/db"
import type { UserId } from "@app/domain"
import { NotFound } from "@app/domain"
import { and, desc, eq, isNull } from "drizzle-orm"
import { Clock, Context, Effect, Layer } from "effect"
import { CurrentUser } from "./context.ts"

export interface TokenInfo {
  readonly id: string
  readonly name: string
  readonly createdAt: number
  readonly lastUsedAt: number | null
}

// API tokens let pi's `/publish` act as a user. Only the sha256 is stored, so a leaked database
// doesn't leak tokens.
export class Tokens extends Context.Service<
  Tokens,
  {
    readonly list: () => Effect.Effect<Array<TokenInfo>, never, CurrentUser>
    readonly create: (name: string) => Effect.Effect<TokenInfo & { token: string }, never, CurrentUser>
    readonly revoke: (id: string) => Effect.Effect<void, NotFound, CurrentUser>
    readonly authenticate: (token: string) => Effect.Effect<{ userId: UserId } | null>
  }
>()("learn/services/Tokens") {
  static readonly layer = Layer.effect(
    Tokens,
    Effect.gen(function* () {
      const { drizzle: db, run } = yield* Db
      const info = {
        id: apiToken.id,
        name: apiToken.name,
        createdAt: apiToken.createdAt,
        lastUsedAt: apiToken.lastUsedAt,
      }

      const list = Effect.fn("Tokens.list")(function* () {
        const user = yield* CurrentUser
        return yield* run(() =>
          db
            .select(info)
            .from(apiToken)
            .where(and(eq(apiToken.userId, user.userId), isNull(apiToken.revokedAt)))
            .orderBy(desc(apiToken.createdAt)),
        )
      })

      const create = Effect.fn("Tokens.create")(function* (name: string) {
        const user = yield* CurrentUser
        const now = yield* Clock.currentTimeMillis
        const token = newApiToken()
        const row = {
          id: uuidv7(now),
          userId: user.userId,
          hash: yield* Effect.promise(() => sha256Hex(token)),
          name,
          createdAt: now,
        }
        yield* run(() => db.insert(apiToken).values(row))
        return { id: row.id, name, createdAt: now, lastUsedAt: null, token }
      })

      const revoke = Effect.fn("Tokens.revoke")(function* (id: string) {
        const user = yield* CurrentUser
        const now = yield* Clock.currentTimeMillis
        const done = yield* run(() =>
          db
            .update(apiToken)
            .set({ revokedAt: now })
            .where(and(eq(apiToken.id, id), eq(apiToken.userId, user.userId), isNull(apiToken.revokedAt)))
            .returning({ id: apiToken.id }),
        )
        if (done.length === 0) return yield* new NotFound({ message: "token not found" })
      })

      const authenticate = Effect.fn("Tokens.authenticate")(function* (token: string) {
        if (!token.startsWith("lrn_")) return null
        const hash = yield* Effect.promise(() => sha256Hex(token))
        const [row] = yield* run(() =>
          db
            .select({ id: apiToken.id, userId: apiToken.userId, lastUsedAt: apiToken.lastUsedAt })
            .from(apiToken)
            .where(and(eq(apiToken.hash, hash), isNull(apiToken.revokedAt)))
            .limit(1),
        )
        if (row === undefined) return null
        // Record use at most once an hour: a write per request would be the costliest thing here.
        const now = yield* Clock.currentTimeMillis
        if (row.lastUsedAt === null || now - row.lastUsedAt > 3_600_000)
          yield* run(() => db.update(apiToken).set({ lastUsedAt: now }).where(eq(apiToken.id, row.id)))
        return { userId: row.userId as UserId }
      })

      return Tokens.of({ list, create, revoke, authenticate })
    }),
  )
}
