import { CurrentUser, Handle, HandleTaken, InvalidHandle, isReservedHandle, type Me } from "@app/api"
import { Database, raw } from "@app/db"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"

export class Profiles extends Context.Service<
  Profiles,
  {
    readonly me: Effect.Effect<Me, never, CurrentUser>
    // The handle is already pattern-checked by the payload schema.
    readonly setHandle: (handle: Handle) => Effect.Effect<Me, InvalidHandle | HandleTaken, CurrentUser>
  }
>()("@app/services/Profiles") {
  static readonly layer = Layer.effect(
    Profiles,
    Effect.gen(function* () {
      const db = yield* Database

      const me = Effect.gen(function* () {
        const user = yield* CurrentUser
        const rows = yield* db
          .query(
            raw(sql`select handle, bio, lesson_count from profile where user_id = ${user.id}`),
            ProfileRow,
          )
          .pipe(Effect.orDie)
        const result: Me = {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          handle: rows[0]?.handle ?? null,
          bio: rows[0]?.bio ?? null,
          lesson_count: rows[0]?.lesson_count ?? 0,
        }
        return result
      }).pipe(Effect.withSpan("Profiles.me"))

      const setHandle = Effect.fn("Profiles.setHandle")(function* (handle: Handle) {
        const user = yield* CurrentUser
        if (isReservedHandle(handle)) return yield* new InvalidHandle({ message: `"${handle}" is reserved` })
        // `or ignore`: a handle another profile holds (the unique index) updates nothing, so no
        // row comes back. One statement, so a racing twin cannot slip in between check and write.
        const updated = yield* db
          .query(
            raw(sql`update or ignore profile set handle = ${handle} where user_id = ${user.id}
              returning handle`),
            HandleRow,
          )
          .pipe(Effect.orDie)
        if (updated.length === 0) return yield* new HandleTaken({ handle })
        return yield* me
      })

      return Profiles.of({ me, setHandle })
    }),
  )
}

const ProfileRow = Schema.Struct({
  handle: Handle,
  bio: Schema.NullOr(Schema.String),
  lesson_count: Schema.Int,
})
const HandleRow = Schema.Struct({ handle: Handle })
