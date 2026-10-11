import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  type FakeRequest,
  type FakeState,
  fakeProvider,
  lessonScript,
  type RunServices,
  runGeneration,
} from "@app/agent"
import { Api, type GenerationEvent, type GenerationId } from "@app/api"
import { Auth } from "@app/auth"
import { createTestSession, createTestSessionFor } from "@app/auth/testing"
import { D1 } from "@app/db"
import { GenerationRunner, type Storage } from "@app/services"
import { type Config, ConfigProvider, Context, Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { convertV4MiniflareOptions, Miniflare } from "miniflare"
import { RunLive } from "../src/generation-agent.ts"
import { GenerationRunnerDO } from "../src/generation-runner.ts"
import { ApiLive, HandlersLive } from "../src/http.ts"
import { WriteLimit } from "../src/rate-limit.ts"
import { sseFrame, sseHeaders } from "../src/sse.ts"
import { StorageR2 } from "../src/storage-r2.ts"

// Integration tests run the Worker's own layers in Node against Miniflare's local D1 and R2
// (in memory, a fresh database per test file, migrated with the same SQL files wrangler applies).

export const origin = "http://localhost:3000"
const migrationsDir = join(import.meta.dirname, "../../../packages/db/migrations")
export const contentDir = join(import.meta.dirname, "../../../content")

// Models of the generation tests. Anthropic has a (fake) platform key; DeepSeek has none, so it is
// BYOK-only. Every request goes to the in-process fake provider (generationRunner below).
const testModels = [
  {
    id: "claude-test",
    label: "Claude (test)",
    provider: "anthropic",
    model: "claude-test",
    context_window: 200000,
    max_tokens: 8192,
    cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75, cache_write_1h: 6 },
  },
  {
    id: "deepseek-test",
    label: "DeepSeek (test)",
    provider: "deepseek",
    model: "deepseek-test",
    context_window: 100000,
    max_tokens: 8192,
    cost: { input: 0.3, output: 1.2, cache_read: 0.03, cache_write: 0 },
  },
  {
    id: "fake",
    label: "Fake",
    provider: "fake",
    model: "fake",
    context_window: 100000,
    max_tokens: 8192,
    cost: { input: 1, output: 1, cache_read: 0.1, cache_write: 1 },
  },
]
export const testPlatformKey = "sk-ant-api03-test-platform-key-not-real"
export const testKek = "lgSIdsl97nsD7WIMWCSKcNMtY52X4yM2GHdlbPeDfNo="
export const testDailyJobs = 3
export const testMaxTurns = 6

// testAuthSecret in packages/auth/src/secret.ts: public, refused when APP_ENV is deployed.
export const testConfig: Readonly<Record<string, string>> = {
  APP_ENV: "test",
  BETTER_AUTH_SECRET: "f/PV4CMPZKwdOG1J+AWa1m2H+XYmlFZpwIlptI9GGVg=",
  BETTER_AUTH_URL: origin,
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  // signInAdmin's user. Spaces and an empty entry, as a hand-edited secret might have.
  ADMIN_USER_IDS: " test-admin, ,",
  GENERATION_MODELS: JSON.stringify(testModels),
  GENERATION_DAILY_JOBS: String(testDailyJobs),
  GENERATION_MAX_TURNS: String(testMaxTurns),
  ANTHROPIC_API_KEY: testPlatformKey,
  BYOK_KEK: testKek,
}

// The fake provider behind every test job: its script, every request it got, and a gate that holds
// requests (to see a job while it runs).
export interface FakeModel {
  script: (state: FakeState) => ReturnType<typeof lessonScript>
  readonly requests: Array<FakeRequest>
  // Holds every provider request until it resolves (the request's abort still ends it).
  hold: Promise<void> | undefined
  // Holds the start of a job's run: the job stays queued until it resolves.
  deferStart: Promise<void> | undefined
  // Every job the runner was asked to cancel (the Durable Object's /cancel).
  readonly cancels: Array<GenerationId>
  // Makes the runner's progress sink fail on a matching event (a broken Durable Object storage).
  failEmit: ((event: GenerationEvent) => boolean) | undefined
  // The run's wall-clock limit (default runTimeoutMs).
  timeoutMs: number | undefined
}

// GenerationRunner for tests: the job's real run (packages/agent runGeneration) in-process, with
// its events kept in memory instead of a Durable Object. `settle` waits for a run to end.
const generationRunner = (model: FakeModel, runs: Map<string, InProcessRun>) =>
  Layer.effect(
    GenerationRunner,
    Effect.gen(function* () {
      const context = yield* Effect.context<RunServices>()
      const providerFetch = fakeProvider({
        script: (state) => model.script(state),
        onRequest: (request) => void model.requests.push(request),
      })
      const held: typeof fetch = Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const signal = init?.signal
          if (model.hold !== undefined) {
            await Promise.race([
              model.hold,
              new Promise<never>((_, reject) => {
                if (signal?.aborted) reject(signal.reason)
                signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
              }),
            ])
          }
          return providerFetch(input, init)
        },
        { preconnect: () => undefined },
      )
      return GenerationRunner.of({
        start: (id) =>
          Effect.sync(() => {
            const controller = new AbortController()
            const events: Array<string> = []
            const deferred = model.deferStart
            const done = (async () => {
              await deferred
              await Effect.runPromiseWith(context)(
                runGeneration(id, {
                  emit: (event) =>
                    model.failEmit?.(event) === true
                      ? Effect.die(new Error("D1_ERROR: transcript storage is gone (secret detail)"))
                      : Effect.sync(() => void events.push(JSON.stringify(event))),
                  signal: controller.signal,
                  fetch: held,
                  timeoutMs: model.timeoutMs,
                }),
              )
            })()
            runs.set(id, { controller, events, done })
            return true
          }),
        cancel: (id) =>
          Effect.sync(() => {
            model.cancels.push(id)
            runs.get(id)?.controller.abort()
          }),
        events: (id, after) =>
          Effect.promise(async () => {
            const run = runs.get(id)
            await run?.done
            const frames = (run?.events ?? []).map((data, index) => sseFrame(index + 1, data)).slice(after)
            return new Response(frames.join(""), { headers: sseHeaders })
          }),
      })
    }),
  )

interface InProcessRun {
  readonly controller: AbortController
  readonly events: Array<string>
  readonly done: Promise<void>
}

export const adminUserId = "test-admin"

export class TestEnv extends Context.Service<
  TestEnv,
  {
    readonly db: D1Database
    readonly bucket: R2Bucket
    // The whole Worker app (HttpApi, /api/auth/*, /c/*) as a fetch handler.
    readonly fetch: (request: Request) => Promise<Response>
    // Stub for the Workers rate limiter: gives a user a budget of `writes` more state-changing
    // requests. Users without a budget are not limited.
    readonly limitWrites: (userId: string, writes: number) => void
    readonly writeLimit: Layer.Layer<WriteLimit>
    // AI generation: the fake model, and a wait for a job's in-process run.
    readonly model: FakeModel
    readonly settle: (id: GenerationId) => Promise<void>
    readonly platform: Layer.Layer<D1 | Storage | WriteLimit | GenerationRunner, Config.ConfigError>
    // The Worker app with these settings changed, as a web handler (dispose it after use).
    readonly appWith: (overrides: Readonly<Record<string, string>>) => {
      readonly handler: (request: Request) => Promise<Response>
      readonly dispose: () => Promise<void>
    }
  }
>()("test/TestEnv") {}

// Applies migrations/*.sql in order, statement by statement, as `wrangler d1 migrations apply`.
const migrate = async (db: D1Database) => {
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
  for (const file of files) {
    const statements = readFileSync(join(migrationsDir, file), "utf8")
      .split("--> statement-breakpoint")
      .map((chunk) =>
        chunk
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .trim(),
      )
      .filter((statement) => statement !== "")
    for (const statement of statements) await db.prepare(statement).run()
  }
}

const config = ConfigProvider.layer(ConfigProvider.fromUnknown(testConfig))

const Local = Layer.effect(
  TestEnv,
  Effect.gen(function* () {
    const mf = yield* Effect.acquireRelease(
      Effect.sync(
        () =>
          new Miniflare(
            convertV4MiniflareOptions({
              modules: true,
              script: "export default { fetch: () => new Response(null, { status: 404 }) }",
              compatibilityDate: "2026-09-30",
              d1Databases: ["DB"],
              r2Buckets: ["CONTENT"],
            }),
          ),
      ),
      (mf) => Effect.promise(() => mf.dispose()),
    )
    // getBindings takes the binding types as a parameter, so they are the Workers types the app uses.
    const bindings = yield* Effect.promise(() => mf.getBindings<{ DB: D1Database; CONTENT: R2Bucket }>())
    const db = bindings.DB
    const bucket = bindings.CONTENT
    yield* Effect.promise(() => migrate(db))
    const budgets = new Map<string, number>()
    const writeLimit = Layer.succeed(
      WriteLimit,
      WriteLimit.of({
        allow: (userId) =>
          Effect.sync(() => {
            const left = budgets.get(userId)
            if (left === undefined) return true
            budgets.set(userId, left - 1)
            return left > 0
          }),
        periodSeconds: 60,
      }),
    )
    const base = Layer.mergeAll(Layer.succeed(D1, db), StorageR2(bucket), config)
    const model: FakeModel = {
      script: lessonScript,
      requests: [],
      hold: undefined,
      deferStart: undefined,
      cancels: [],
      failEmit: undefined,
      timeoutMs: undefined,
    }
    const runs = new Map<string, InProcessRun>()
    const platform = Layer.mergeAll(
      base,
      writeLimit,
      generationRunner(model, runs).pipe(Layer.provide(RunLive.pipe(Layer.provideMerge(base)))),
    )
    const web = yield* Effect.acquireRelease(
      Effect.sync(() =>
        HttpRouter.toWebHandler(
          ApiLive.pipe(Layer.provide(platform), Layer.provide(HttpServer.layerServices)),
        ),
      ),
      (web) => Effect.promise(() => web.dispose()),
    )
    // The same app on the same D1 and R2, with other settings (no job runner).
    const appWith = (overrides: Readonly<Record<string, string>>) => {
      const other = Layer.mergeAll(
        Layer.succeed(D1, db),
        StorageR2(bucket),
        ConfigProvider.layer(ConfigProvider.fromUnknown({ ...testConfig, ...overrides })),
        writeLimit,
        GenerationRunnerDO(undefined),
      )
      return HttpRouter.toWebHandler(
        ApiLive.pipe(Layer.provide(other), Layer.provide(HttpServer.layerServices)),
      )
    }
    return TestEnv.of({
      db,
      bucket,
      appWith,
      fetch: (request) => web.handler(request),
      limitWrites: (userId, writes) => budgets.set(userId, writes),
      writeLimit,
      model,
      settle: async (id) => {
        await runs.get(id)?.done
      },
      platform,
    })
  }),
)

// The services (Auth, Lessons, HotScore, …) on the same D1 and R2 as the web handler, plus TestEnv.
export const TestLayer = Layer.unwrap(
  Effect.gen(function* () {
    const env = yield* TestEnv
    return Layer.mergeAll(HandlersLive, HttpServer.layerServices).pipe(Layer.provide(env.platform))
  }),
).pipe(Layer.provideMerge(Local))

// A typed client for the real Worker app, sending `cookie` (a session) when given. Requests go
// through the full router and middleware, as from a browser on the app's origin.
export const clientWith = (headers: Record<string, string>) =>
  Effect.gen(function* () {
    const env = yield* TestEnv
    const fetch: typeof globalThis.fetch = Object.assign(
      (input: RequestInfo | URL, init?: RequestInit) => env.fetch(new Request(input, init)),
      { preconnect: () => undefined },
    )
    return yield* HttpApiClient.make(Api, {
      baseUrl: origin,
      transformClient: (client) =>
        client.pipe(
          HttpClient.mapRequest(HttpClientRequest.setHeaders(headers)),
          HttpClient.transformResponse(Effect.provideService(FetchHttpClient.Fetch, fetch)),
        ),
    }).pipe(Effect.provide(FetchHttpClient.layer))
  })

export const anonymous = () => clientWith({})

// A new Google-signed-in user (created through Better Auth, so the profile hook runs) and a
// client carrying their session cookie.
export const signIn = (
  name: string,
  email = `${name.toLowerCase().replace(/\W+/g, ".")}.${crypto.randomUUID().slice(0, 8)}@example.com`,
) =>
  Effect.gen(function* () {
    const auth = yield* Auth
    const session = yield* auth.use((instance) => createTestSession(instance, { name, email }))
    const client = yield* clientWith({ cookie: session.cookie })
    return { user: session.user, cookie: session.cookie, client }
  }).pipe(Effect.orDie)

// The admin of testConfig (inserted once per database, with a profile) and a fresh session.
export const signInAdmin = () =>
  Effect.gen(function* () {
    const env = yield* TestEnv
    const auth = yield* Auth
    yield* Effect.promise(() =>
      env.db.batch([
        env.db
          .prepare(
            `insert or ignore into "user" (id, name, email, email_verified, image, created_at, updated_at)
            values (?, 'Admin', 'admin@users.invalid', 1, null, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
          )
          .bind(adminUserId),
        env.db
          .prepare("insert or ignore into profile (user_id, handle, created_at) values (?, 'site_admin', 0)")
          .bind(adminUserId),
      ]),
    )
    const cookie = yield* auth.use((instance) => createTestSessionFor(instance, adminUserId))
    const client = yield* clientWith({ cookie })
    return { cookie, client }
  }).pipe(Effect.orDie)

// Raw request to the Worker app (for /c/*, /api/auth/*, and bodies the typed client won't send).
export const rawFetch = (path: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const env = yield* TestEnv
    return yield* Effect.promise(() => env.fetch(new Request(`${origin}${path}`, init)))
  })

export const readContent = (path: string): unknown => JSON.parse(readFileSync(join(contentDir, path), "utf8"))
export const contentBytes = (path: string) => new Uint8Array(readFileSync(join(contentDir, path)))
export const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

// The three shared concepts in content/, prerequisites first.
export const conceptFiles = ["physics.total-time", "physics.average-speed", "physics.mean-speed-theorem"]

// A small valid lesson. `marker` makes its body (and so its hash) unique.
export const tinyLesson = (lang: "en" | "th", marker: string, extra: Record<string, unknown> = {}) => ({
  schema: 1,
  kind: "learn",
  lang,
  title: lang === "en" ? `Tiny ${marker}` : `บทเรียนเล็ก ${marker}`,
  summary: `About ${marker}`,
  parts: { x: { label: "$x$", role: "given", color: "blue", meaning: "the input" } },
  cards: {},
  sections: [{ id: "intro", type: "text", body: `Look at [x:$x$]. ${marker}` }],
  ...extra,
})
