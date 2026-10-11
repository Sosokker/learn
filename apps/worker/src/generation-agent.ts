import { abandonGeneration, runGeneration } from "@app/agent"
import { type GenerationEvent, GenerationId } from "@app/api"
import { Database } from "@app/db"
import { Concepts, GenerationJobs, GenerationSettings, Lessons } from "@app/services"
import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect"
import type { Env } from "./env.ts"
import { storageLayer } from "./platform.ts"
import { sseFrame, sseHeaders, ssePing } from "./sse.ts"

// What a job's run needs: the job row, the settings, and the services its tools call. Built on the
// same D1 and R2 as the Worker.
export const RunLive = Layer.mergeAll(GenerationJobs.layer, Concepts.layer, Lessons.layer).pipe(
  Layer.provideMerge(GenerationSettings.layer),
  Layer.provideMerge(Database.layer),
)

// How long the transcript stays after the job ends, so a reconnecting page can replay it. The job
// row in D1 keeps the result after that.
const keepMs = 24 * 60 * 60 * 1000
const pingMs = 15_000

type Phase = "scheduled" | "running" | "done"

// The part of DurableObjectState this object uses. The real one fits; tests pass a stub.
export interface AgentStorage {
  readonly sql: {
    exec<T extends Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: Array<string | number | null>
    ): { toArray(): Array<T>; one(): T }
  }
  setAlarm(scheduledTime: number): Promise<void>
  deleteAll(): Promise<void>
}

const makeRuntime = (env: Env) => ManagedRuntime.make(RunLive.pipe(Layer.provideMerge(storageLayer(env))))

// One Durable Object per generation job (ADR 0009), named by the job id. The Worker creates the
// job row, then POSTs /start; the run happens in the alarm handler, so it does not depend on that
// request staying open. Progress events go to this object's SQLite (the transcript) and to every
// open /events stream. If the object is evicted mid-run, the alarm runs again, sees "running", and
// fails the job instead of paying for a second run.
//
// A plain class with fetch and alarm (no RPC), so the Worker module stays importable in Node tests.
export class GenerationAgent {
  private readonly runtime: ReturnType<typeof makeRuntime>
  private readonly listeners = new Set<(seq: number, data: string) => void>()
  private controller: AbortController | undefined
  // The tables exist. deleteAll (the transcript's expiry) drops them while this instance lives on,
  // so every entry point checks again.
  private schemaReady = false

  constructor(
    private readonly state: { readonly storage: AgentStorage },
    env: Env,
  ) {
    this.runtime = makeRuntime(env)
  }

  private ensureSchema() {
    if (this.schemaReady) return
    const sql = this.state.storage.sql
    sql.exec("create table if not exists event (seq integer primary key autoincrement, data text not null)")
    sql.exec("create table if not exists meta (key text primary key, value text not null)")
    this.schemaReady = true
  }

  async fetch(request: Request): Promise<Response> {
    this.ensureSchema()
    const url = new URL(request.url)
    if (request.method === "POST" && url.pathname === "/start") return this.start(await request.text())
    if (request.method === "POST" && url.pathname === "/cancel") {
      this.controller?.abort()
      return new Response(null, { status: 204 })
    }
    if (request.method === "GET" && url.pathname === "/events") {
      return this.events(Number(url.searchParams.get("after") ?? "0"))
    }
    return new Response(null, { status: 404 })
  }

  async alarm(): Promise<void> {
    this.ensureSchema()
    const jobId = this.meta("job")
    const phase = this.meta("phase")
    if (jobId === undefined) return
    const id = GenerationId.make(jobId)
    if (phase === "done") {
      // The transcript has been kept long enough.
      await this.state.storage.deleteAll()
      this.schemaReady = false
      return
    }
    if (phase === "running") {
      // A previous alarm died mid-run (eviction, deploy). Do not run (and bill) it twice.
      const reason = "the job was interrupted; try again"
      const status = await this.runtime.runPromise(abandonGeneration(id, reason))
      this.append({ type: "done", status, draft: null, error: status === "succeeded" ? null : reason })
      await this.finish()
      return
    }
    // Settings and bindings first: if they are broken, the alarm fails and retries before the
    // job counts as started.
    await this.runtime.runPromise(Effect.void)
    this.setPhase("running")
    this.controller = new AbortController()
    // The run applies its own wall-clock limit (runTimeoutMs) and fails the job past it.
    await this.runtime.runPromise(
      runGeneration(id, {
        emit: (event) => Effect.sync(() => this.append(event)),
        signal: this.controller.signal,
      }),
    )
    // Canceled before it started: the run did nothing and emitted nothing.
    if (!this.hasDone()) this.append({ type: "done", status: "canceled", draft: null, error: null })
    await this.finish()
  }

  private async start(body: string): Promise<Response> {
    const jobId = Schema.decodeUnknownOption(GenerationId)(body)
    if (Option.isNone(jobId)) return new Response(null, { status: 400 })
    // Idempotent: a retried start does not schedule a second run.
    if (this.meta("job") === undefined) {
      this.setMeta("job", jobId.value)
      this.setPhase("scheduled")
      await this.state.storage.setAlarm(Date.now())
    }
    return new Response(null, { status: 202 })
  }

  private async finish() {
    this.controller = undefined
    this.setPhase("done")
    await this.state.storage.setAlarm(Date.now() + keepMs)
  }

  // Replays the transcript after `after`, then streams new events until `done`.
  private events(after: number): Response {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()
    let closed = false
    const close = () => {
      if (closed) return
      closed = true
      this.listeners.delete(send)
      clearInterval(ping)
      writer.close().catch(() => undefined)
    }
    const write = (text: string) => {
      if (closed) return
      // A failed write means the browser went away.
      writer.write(encoder.encode(text)).catch(close)
    }
    const send = (seq: number, data: string) => {
      write(sseFrame(seq, data))
      if (isDone(data)) close()
    }
    const ping = setInterval(() => write(ssePing), pingMs)
    const rows = this.state.storage.sql
      .exec<{ seq: number; data: string }>("select seq, data from event where seq > ? order by seq", after)
      .toArray()
    for (const row of rows) send(row.seq, row.data)
    // Nothing more will come: the job ended, or this object has no job (its transcript expired).
    if (!closed && (this.meta("phase") === "done" || this.meta("job") === undefined)) close()
    if (!closed) this.listeners.add(send)
    return new Response(readable, { headers: sseHeaders })
  }

  private append(event: GenerationEvent) {
    const data = JSON.stringify(event)
    const row = this.state.storage.sql
      .exec<{ seq: number }>("insert into event (data) values (?) returning seq", data)
      .one()
    if (event.type === "done") this.setMeta("ended", "1")
    for (const listener of [...this.listeners]) listener(row.seq, data)
  }

  private hasDone() {
    return this.meta("ended") !== undefined
  }

  private meta(key: string): string | undefined {
    return this.state.storage.sql
      .exec<{ value: string }>("select value from meta where key = ?", key)
      .toArray()[0]?.value
  }

  private setPhase(phase: Phase) {
    this.setMeta("phase", phase)
  }

  private setMeta(key: string, value: string) {
    this.state.storage.sql.exec(
      "insert into meta (key, value) values (?, ?) on conflict (key) do update set value = excluded.value",
      key,
      value,
    )
  }
}

const isDone = (data: string) => data.startsWith('{"type":"done"')
