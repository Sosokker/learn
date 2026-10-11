import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { GenerationEvent, GenerationId } from "@app/api"
import { utcDay } from "@app/services"
import { assert, layer } from "@effect/vitest"
import { Effect, Schema } from "effect"
import type { Env } from "../src/env.ts"
import { type AgentStorage, GenerationAgent } from "../src/generation-agent.ts"
import { signIn, TestEnv, TestLayer, testConfig } from "./support.ts"

// The job's Durable Object class itself: start, the run in the alarm, the interrupted run, and the
// transcript's expiry. Its storage is a stub on node:sqlite (the same SQL as the object's own
// SQLite); D1 and R2 are Miniflare's, as in the other tests. The job uses the built-in fake model.

interface StubStorage extends AgentStorage {
  readonly db: DatabaseSync
  alarm: number | undefined
}

const stubStorage = (): StubStorage => {
  const db = new DatabaseSync(":memory:")
  const storage: StubStorage = {
    db,
    alarm: undefined,
    sql: {
      exec: <T extends Record<string, SqlStorageValue>>(
        query: string,
        ...bindings: Array<string | number | null>
      ) => {
        const statement = db.prepare(query)
        const values: Array<SQLInputValue> = bindings
        const returnsRows = statement.columns().length > 0
        const rows: Array<T> = returnsRows ? statement.all(...values).map((row) => rowOf<T>(row)) : []
        if (!returnsRows) statement.run(...values)
        return {
          toArray: () => rows,
          one: () => {
            const first = rows[0]
            if (first === undefined) throw new Error("no rows")
            return first
          },
        }
      },
    },
    setAlarm: async (time) => {
      storage.alarm = time
    },
    // Like the real one: every table goes.
    deleteAll: async () => {
      const tables = db
        .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
        .all()
      for (const table of tables) db.exec(`drop table "${String(table.name)}"`)
      storage.alarm = undefined
    },
  }
  return storage
}

// node:sqlite rows are plain objects of SQL values, the shape the Workers cursor returns.
const rowOf = <T extends Record<string, SqlStorageValue>>(row: unknown): T => {
  const out: Record<string, SqlStorageValue> = {}
  if (typeof row === "object" && row !== null) {
    for (const [key, value] of Object.entries(row)) {
      out[key] = typeof value === "string" || typeof value === "number" || value === null ? value : null
    }
  }
  // The caller names the columns it selected (as with the Workers cursor, unchecked).
  return out as T
}

const agentFor = (storage: StubStorage) =>
  Effect.gen(function* () {
    const env = yield* TestEnv
    const workerEnv: Env = { ...testConfig, DB: env.db, CONTENT: env.bucket }
    return new GenerationAgent({ storage }, workerEnv)
  })

// A queued platform job of the built-in fake model, as Generations.create writes it.
const queuedJob = (userId: string) =>
  Effect.gen(function* () {
    const env = yield* TestEnv
    const id = GenerationId.make(crypto.randomUUID())
    const now = Date.now()
    yield* Effect.promise(() =>
      env.db
        .prepare(
          `insert into generation_job (id, user_id, status, prompt, lang, model, billing, day, created_at)
          values (?, ?, 'queued', 'Why do boats float on water?', 'en', 'fake', 'platform', ?, ?)`,
        )
        .bind(id, userId, utcDay(now), now)
        .run(),
    )
    return id
  })

const jobRow = (id: GenerationId) =>
  Effect.gen(function* () {
    const env = yield* TestEnv
    return yield* Effect.promise(() =>
      env.db
        .prepare("select status, error, version_id from generation_job where id = ?")
        .bind(id)
        .first<{ status: string; error: string | null; version_id: string | null }>(),
    )
  })

const eventsOf = (agent: GenerationAgent) =>
  Effect.promise(async () => {
    const response = await agent.fetch(new Request("https://generation/events?after=0"))
    const text = await response.text()
    return text
      .split("\n\n")
      .filter((frame) => frame.startsWith("id: "))
      .map((frame) =>
        Schema.decodeUnknownSync(Schema.fromJsonString(GenerationEvent))(frame.split("data: ")[1]),
      )
  })

const start = (agent: GenerationAgent, id: GenerationId) =>
  Effect.promise(() => agent.fetch(new Request("https://generation/start", { method: "POST", body: id })))

layer(TestLayer, { excludeTestServices: true })("GenerationAgent (Durable Object)", (it) => {
  it.effect("runs the job in its alarm, keeps the transcript, and forgets it after the expiry", () =>
    Effect.gen(function* () {
      const user = yield* signIn("Object Owner")
      const storage = stubStorage()
      const agent = yield* agentFor(storage)
      const id = yield* queuedJob(user.user.id)

      assert.strictEqual((yield* start(agent, id)).status, 202)
      assert.isDefined(storage.alarm)
      // A retried start does not schedule a second run.
      storage.alarm = undefined
      assert.strictEqual((yield* start(agent, id)).status, 202)
      assert.isUndefined(storage.alarm)

      yield* Effect.promise(() => agent.alarm())
      const row = yield* jobRow(id)
      assert.strictEqual(row?.status, "succeeded", row?.error ?? "")
      assert.isNotNull(row?.version_id)
      const events = yield* eventsOf(agent)
      const done = events.at(-1)
      assert.strictEqual(done?.type === "done" ? done.status : undefined, "succeeded")
      // The transcript is kept for a day.
      assert.isAbove(storage.alarm ?? 0, Date.now() + 23 * 60 * 60 * 1000)

      // The expiry drops every table; the same instance still answers (an empty, ended stream).
      yield* Effect.promise(() => agent.alarm())
      assert.deepStrictEqual(yield* eventsOf(agent), [])
      // And a later alarm finds no job and does nothing.
      yield* Effect.promise(() => agent.alarm())
    }),
  )

  it.effect("fails a job whose run was interrupted instead of running it again", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const user = yield* signIn("Evicted Owner")
      const storage = stubStorage()
      const agent = yield* agentFor(storage)
      const id = yield* queuedJob(user.user.id)
      yield* start(agent, id)
      // An earlier alarm got as far as starting the run, then the object was evicted.
      storage.db.prepare("update meta set value = 'running' where key = 'phase'").run()
      yield* Effect.promise(() =>
        env.db
          .prepare("update generation_job set status = 'running', started_at = ? where id = ?")
          .bind(Date.now(), id)
          .run(),
      )

      yield* Effect.promise(() => agent.alarm())
      const row = yield* jobRow(id)
      assert.strictEqual(row?.status, "failed")
      assert.include(row?.error ?? "", "interrupted")
      const events = yield* eventsOf(agent)
      assert.deepStrictEqual(
        events.map((event) => event.type),
        ["done"],
      )
    }),
  )
})
