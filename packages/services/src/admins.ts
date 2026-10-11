import type { UserId } from "@app/api"
import { Config, Context, Effect, Layer } from "effect"

// Who may moderate: the user ids in the Worker's ADMIN_USER_IDS (a secret, comma separated).
// Empty or unset means nobody. The Admin middleware (apps/worker/src/session.ts) checks it on
// every admin request; reading it here keeps one parser for the middleware, /api/me and the
// comment lists (admins see hidden comments). Only a session cookie carries admin powers: a user
// who signed in with an API token is never an admin, so a leaked token cannot moderate.
export class Admins extends Context.Service<
  Admins,
  { readonly isAdmin: (user: { readonly id: UserId; readonly viaToken: boolean }) => boolean }
>()("@app/services/Admins") {
  static readonly layer = Layer.effect(
    Admins,
    Effect.gen(function* () {
      const ids = yield* Config.String("ADMIN_USER_IDS").pipe(
        Config.map((value) =>
          value
            .split(",")
            .map((id) => id.trim())
            .filter((id) => id !== ""),
        ),
        Config.withDefault<ReadonlyArray<string>>([]),
      )
      const admins = new Set(ids)
      return Admins.of({ isAdmin: (user) => !user.viaToken && admins.has(user.id) })
    }),
  )
}
