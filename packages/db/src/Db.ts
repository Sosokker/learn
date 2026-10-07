import type { D1Database } from "@cloudflare/workers-types"
import { type DrizzleD1Database, drizzle } from "drizzle-orm/d1"
import { Context, Effect, Layer, Schema } from "effect"

export type Drizzle = DrizzleD1Database

export class DbError extends Schema.TaggedError<DbError>()("DbError", { cause: Schema.Defect() }) {
  // D1 reports constraint failures only in the message text, and drizzle wraps that error in its
  // own, so look down the cause chain.
  get isUnique(): boolean {
    let e: unknown = this.cause
    for (let depth = 0; e !== undefined && e !== null && depth < 5; depth++) {
      if (/UNIQUE constraint failed/i.test(String((e as { message?: unknown }).message ?? e))) return true
      e = (e as { cause?: unknown }).cause
    }
    return false
  }
}

// D1 through drizzle's D1 driver. Drizzle builds typed SQL; Effect runs it. D1 has no
// interactive transactions, so writes that must happen together go through `db.batch([...])`,
// which D1 runs as one atomic unit.
export class Db extends Context.Service<
  Db,
  {
    readonly drizzle: Drizzle
    // A query that should not fail: a failure is a defect (500).
    readonly run: <A>(f: (db: Drizzle) => Promise<A>) => Effect.Effect<A>
    // A query whose failure the caller handles, e.g. a unique constraint.
    readonly attempt: <A>(f: (db: Drizzle) => Promise<A>) => Effect.Effect<A, DbError>
  }
>()("learn/db/Db") {
  static fromDrizzle(db: Drizzle): Db["Service"] {
    const attempt = <A>(f: (db: Drizzle) => Promise<A>) =>
      Effect.tryPromise({ try: () => f(db), catch: (cause) => new DbError({ cause }) })
    return Db.of({ drizzle: db, attempt, run: (f) => Effect.orDie(attempt(f)) })
  }

  static layer(d1: D1Database): Layer.Layer<Db> {
    return Layer.succeed(Db, Db.fromDrizzle(drizzle(d1)))
  }
}
