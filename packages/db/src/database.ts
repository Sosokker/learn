import { D1Client } from "@effect/sql-d1"
import type { SQL } from "drizzle-orm"
import { SQLiteDialect } from "drizzle-orm/sqlite-core"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import { Context, Effect, Layer, Schema } from "effect"
import { Reactivity } from "effect/reactivity"
import type { SqlError } from "effect/sql"

// The Worker's D1 binding (env.DB). Tests provide Miniflare's local D1 here.
export class D1 extends Context.Service<D1, D1Database>()("@app/db/D1") {}

// Drizzle only compiles typed SQL (`.toSQL()`); @effect/sql-d1 runs it, so every query is an
// Effect with a span. The proxy callback is never invoked.
export const sqlBuilder = drizzle(() =>
  Promise.reject(new Error("sqlBuilder only compiles SQL; run it with Database")),
)

// Anything that compiles to one SQL statement: a Drizzle query builder, or `raw(sql\`…\`)`.
export interface Compilable {
  toSQL(): { readonly sql: string; readonly params: ReadonlyArray<unknown> }
}

const dialect = new SQLiteDialect()

// A hand-written statement from Drizzle's `sql` tag: values are bound parameters, tables and
// columns are quoted identifiers. For SQL the builder cannot express (row values, upserts with
// subqueries, FTS5 `match`).
export const raw = (fragment: SQL): Compilable => ({
  toSQL: () => {
    const query = dialect.sqlToQuery(fragment)
    return { sql: query.sql, params: query.params }
  },
})

export class Database extends Context.Service<
  Database,
  {
    // Runs one statement and decodes every row with `row`. Rows are keyed by result column name, so
    // select columns whose names are the keys you decode (alias with `.as()` otherwise).
    readonly query: <S extends Schema.Decoder<unknown>>(
      statement: Compilable,
      row: S,
    ) => Effect.Effect<ReadonlyArray<S["Type"]>, SqlError.SqlError | Schema.SchemaError>
    readonly run: (statement: Compilable) => Effect.Effect<void, SqlError.SqlError>
    // One D1 batch: the statements run in order as one transaction (D1 has no interactive
    // transactions), and all of them roll back if one fails.
    readonly batch: (statements: ReadonlyArray<Compilable>) => Effect.Effect<void, SqlError.SqlError>
    readonly ready: Effect.Effect<void, SqlError.SqlError>
  }
>()("@app/db/Database") {
  static readonly layer = Layer.effect(
    Database,
    Effect.gen(function* () {
      const d1 = yield* D1
      const client = yield* D1Client.make({ db: d1 }).pipe(Effect.provide(Reactivity.layer))
      const statement = (compilable: Compilable) => {
        const compiled = compilable.toSQL()
        return client.unsafe(compiled.sql, compiled.params)
      }
      return Database.of({
        query: Effect.fn("Database.query")(function* <S extends Schema.Decoder<unknown>>(
          compilable: Compilable,
          row: S,
        ) {
          const rows = yield* statement(compilable)
          return yield* Schema.decodeUnknownEffect(Schema.Array(row))(rows)
        }),
        run: Effect.fn("Database.run")(function* (compilable: Compilable) {
          yield* statement(compilable)
        }),
        batch: Effect.fn("Database.batch")(function* (statements: ReadonlyArray<Compilable>) {
          yield* client.batch(statements.map(statement))
        }),
        ready: Effect.asVoid(client`select 1`).pipe(Effect.withSpan("Database.ready")),
      })
    }),
  )
}
