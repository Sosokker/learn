import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Api } from "@app/api"
import { Auth } from "@app/auth"
import { createTestSession } from "@app/auth/testing"
import { D1 } from "@app/db"
import { ConfigProvider, Context, Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { convertV4MiniflareOptions, Miniflare } from "miniflare"
import { ApiLive, HandlersLive } from "../src/http.ts"
import { WriteLimit } from "../src/rate-limit.ts"
import { StorageR2 } from "../src/storage-r2.ts"

// Integration tests run the Worker's own layers in Node against Miniflare's local D1 and R2
// (in memory, a fresh database per test file, migrated with the same SQL files wrangler applies).

export const origin = "http://localhost:3000"
const migrationsDir = join(import.meta.dirname, "../../../packages/db/migrations")
export const contentDir = join(import.meta.dirname, "../../../content")

// testAuthSecret in packages/auth/src/secret.ts: public, refused when APP_ENV is deployed.
const testConfig = {
  APP_ENV: "test",
  BETTER_AUTH_SECRET: "f/PV4CMPZKwdOG1J+AWa1m2H+XYmlFZpwIlptI9GGVg=",
  BETTER_AUTH_URL: origin,
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
}

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
    const platform = Layer.mergeAll(
      Layer.succeed(D1, db),
      StorageR2(bucket),
      writeLimit,
      ConfigProvider.layer(ConfigProvider.fromUnknown(testConfig)),
    )
    const web = yield* Effect.acquireRelease(
      Effect.sync(() =>
        HttpRouter.toWebHandler(
          ApiLive.pipe(Layer.provide(platform), Layer.provide(HttpServer.layerServices)),
        ),
      ),
      (web) => Effect.promise(() => web.dispose()),
    )
    return TestEnv.of({
      db,
      bucket,
      fetch: (request) => web.handler(request),
      limitWrites: (userId, writes) => budgets.set(userId, writes),
      writeLimit,
    })
  }),
)

// The services (Auth, Lessons, HotScore, …) on the same D1 and R2 as the web handler, plus TestEnv.
export const TestLayer = Layer.unwrap(
  Effect.gen(function* () {
    const env = yield* TestEnv
    return Layer.mergeAll(HandlersLive, HttpServer.layerServices).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(D1, env.db),
          StorageR2(env.bucket),
          env.writeLimit,
          ConfigProvider.layer(ConfigProvider.fromUnknown(testConfig)),
        ),
      ),
    )
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
