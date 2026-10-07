import { Database, raw } from "@app/db"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { contentKey } from "./content.ts"
import { Storage, type StoredObject } from "./storage.ts"

// `/c/<hash>.json`: the immutable, edge-cached URL of a body. A hash is served only when it
// belongs to a version of a public or unlisted (not deleted) lesson, or to a concept (concepts
// are public). A private lesson's body is never served here, even to its owner: the owner reads
// it through the owner-checked API, which is never cached.
//
// Caveat of immutable caching: once served, a body stays in browser and edge caches for up to a
// year even if its lesson later turns private or is deleted.
export class ContentAccess extends Context.Service<
  ContentAccess,
  { readonly publicBody: (hash: string) => Effect.Effect<Option.Option<StoredObject>> }
>()("@app/services/ContentAccess") {
  static readonly layer = Layer.effect(
    ContentAccess,
    Effect.gen(function* () {
      const db = yield* Database
      const storage = yield* Storage
      return ContentAccess.of({
        publicBody: Effect.fn("ContentAccess.publicBody")(function* (hash: string) {
          if (!/^[0-9a-f]{64}$/.test(hash)) return Option.none()
          const rows = yield* db
            .query(
              raw(sql`select 1 as ok from lesson_version v join lesson l on l.id = v.lesson_id
                where v.body_hash = ${hash} and l.visibility in ('public', 'unlisted') and l.deleted_at is null
                union all
                select 1 as ok from concept_version where body_hash = ${hash}
                limit 1`),
              OkRow,
            )
            .pipe(Effect.orDie)
          if (rows.length === 0) return Option.none()
          return yield* storage.get(contentKey(hash)).pipe(Effect.orDie)
        }),
      })
    }),
  )
}

const OkRow = Schema.Struct({ ok: Schema.Int })
