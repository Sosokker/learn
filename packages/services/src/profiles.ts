import { Db, profile, publicUser } from "@app/db"
import { Conflict, type Handle, type Me, NotFound } from "@app/domain"
import { eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { CurrentUser } from "./context.ts"

export class Profiles extends Context.Service<
  Profiles,
  {
    readonly me: () => Effect.Effect<Me, NotFound, CurrentUser>
    readonly update: (patch: {
      readonly handle?: Handle
      readonly bio?: string | null
    }) => Effect.Effect<Me, NotFound | Conflict, CurrentUser>
  }
>()("learn/services/Profiles") {
  static readonly layer = Layer.effect(
    Profiles,
    Effect.gen(function* () {
      const { drizzle: db, run, attempt } = yield* Db

      const me = Effect.fn("Profiles.me")(function* () {
        const user = yield* CurrentUser
        const [row] = yield* run(() =>
          db
            .select({
              name: publicUser.name,
              email: publicUser.email,
              image: publicUser.image,
              handle: profile.handle,
              bio: profile.bio,
            })
            .from(publicUser.table)
            .innerJoin(profile, eq(profile.userId, publicUser.id))
            .where(eq(publicUser.id, user.userId)),
        )
        if (row === undefined) return yield* new NotFound({ message: "profile not found" })
        return { userId: user.userId, ...row, handle: row.handle as Handle }
      })

      const update = Effect.fn("Profiles.update")(function* (patch: {
        readonly handle?: Handle
        readonly bio?: string | null
      }) {
        const user = yield* CurrentUser
        const set = {
          ...(patch.handle === undefined ? {} : { handle: patch.handle }),
          ...(patch.bio === undefined ? {} : { bio: patch.bio }),
        }
        if (Object.keys(set).length > 0)
          yield* attempt(() => db.update(profile).set(set).where(eq(profile.userId, user.userId))).pipe(
            Effect.catchTag("DbError", (e) =>
              e.isUnique
                ? Effect.fail(new Conflict({ message: `@${patch.handle} is taken` }))
                : Effect.die(e),
            ),
          )
        return yield* me()
      })

      return Profiles.of({ me, update })
    }),
  )
}
