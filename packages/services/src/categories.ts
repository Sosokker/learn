import { Category } from "@app/api"
import { Database, raw } from "@app/db"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"

export class Categories extends Context.Service<
  Categories,
  { readonly list: Effect.Effect<ReadonlyArray<Category>> }
>()("@app/services/Categories") {
  static readonly layer = Layer.effect(
    Categories,
    Effect.gen(function* () {
      const db = yield* Database
      return Categories.of({
        list: db
          .query(
            raw(sql`select id, parent_id, name_en, name_th, sort from category order by parent_id, sort, id`),
            Category,
          )
          .pipe(Effect.orDie, Effect.withSpan("Categories.list")),
      })
    }),
  )
}

// A category id and the ids of every category above it, from the dotted path:
// `math.analysis.real-analysis` → `math`, `math.analysis`, `math.analysis.real-analysis`.
export const categoryAncestors = (id: string): ReadonlyArray<string> =>
  id.split(".").map((_, index, parts) => parts.slice(0, index + 1).join("."))
