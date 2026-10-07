import { D1 } from "@app/db"
import { HotScore } from "@app/services"
import { ConfigProvider, Effect, Exit, Layer, ManagedRuntime } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { ApiLive, HandlersLive } from "./http.ts"
import { WriteLimit } from "./rate-limit.ts"
import { StorageR2 } from "./storage-r2.ts"

// Bindings and vars from wrangler.jsonc; secrets from `wrangler secret put` (or .dev.vars locally).
// Static assets (the web SPA) are served before the Worker runs; only /api/* and /c/* reach
// `fetch` (assets.run_worker_first).
export interface Env {
  readonly DB: D1Database
  readonly CONTENT: R2Bucket
  // Per-user limit on state-changing API requests (wrangler.jsonc `ratelimits`). Optional: without
  // it nothing is limited.
  readonly WRITE_LIMIT?: RateLimit
  // dev | test | deployed (the default). Unlocks the public dev auth secret locally.
  readonly APP_ENV?: string
  readonly BETTER_AUTH_SECRET?: string
  readonly BETTER_AUTH_URL?: string
  readonly BETTER_AUTH_TRUSTED_ORIGINS?: string
  readonly GOOGLE_CLIENT_ID?: string
  readonly GOOGLE_CLIENT_SECRET?: string
}

type App = ReturnType<typeof makeApp>

// Built on the first event, then reused for the isolate's lifetime. Workers forbid async work at
// module scope, and the bindings arrive with the event. A failed build is dropped, so the next
// event builds again (e.g. after a secret is set) instead of serving 503 until the isolate dies.
let app: App | undefined

const appFor = (env: Env): Promise<App | undefined> => {
  const current = app ?? makeApp(env)
  app = current
  return current.ready.then((ok) => {
    if (ok) return current
    if (app === current) {
      app = undefined
      void current.dispose()
    }
    return undefined
  })
}

// Paths whose successful responses never change, so the edge cache can answer repeats: `/c/<hash>`
// bodies, and the concept bundle of a lesson version (cached only when the response says
// `public`, i.e. for public and unlisted lessons).
const edgeCached = /^\/c\/|^\/api\/lessons\/[^/]+\/versions\/[^/]+\/concepts$/

// The edge cache key of a request, or undefined when it is not cached. The key is the path alone,
// so a query string or a header (a cookie) cannot make a new entry or skip the cached one.
export const edgeCacheKey = (request: Request): Request | undefined => {
  const url = new URL(request.url)
  if (request.method !== "GET" || !edgeCached.test(url.pathname)) return undefined
  return new Request(`${url.origin}${url.pathname}`, { method: "GET" })
}

// The Worker's fetch, with `waitUntil` passed alone so tests can call it.
export async function handleFetch(
  request: Request,
  env: Env,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<Response> {
  const url = new URL(request.url)
  // Liveness answers without the app: it must say "up" even when the settings are broken.
  if (request.method === "GET" && url.pathname === "/api/health") return Response.json({ status: "ok" })
  const current = await appFor(env)
  // 503 without details while misconfigured; the cause is in the log.
  if (current === undefined) return new Response(null, { status: 503 })
  const key = edgeCacheKey(request)
  if (key === undefined) return current.fetch(request)
  // A cache hit still runs this Worker (run_worker_first) but skips the app, D1 and R2 (the
  // Cache API needs the custom domain; on workers.dev it is a no-op).
  const cached = await caches.default.match(key)
  if (cached !== undefined) return cached
  const response = await current.fetch(request)
  if (isShareable(response)) waitUntil(caches.default.put(key, response.clone()))
  return response
}

export default {
  fetch: (request, env, ctx) => handleFetch(request, env, (promise) => ctx.waitUntil(promise)),
  // Cron Trigger (*/30): recompute hot scores of lessons made public in the last 14 days.
  scheduled(controller, env, ctx) {
    ctx.waitUntil(
      appFor(env).then((current) =>
        current?.services.runPromise(HotScore.use((hot) => hot.recompute(controller.scheduledTime))),
      ),
    )
  },
} satisfies ExportedHandler<Env>

// Only a 200 that says it is public, and sets no cookie (a signed-in reader's refreshed session).
export function isShareable(response: Response) {
  return (
    response.status === 200 &&
    (response.headers.get("cache-control") ?? "").split(",").some((part) => part.trim() === "public") &&
    !response.headers.has("set-cookie")
  )
}

function makeApp(env: Env) {
  const config = ConfigProvider.layer(
    ConfigProvider.fromUnknown({
      APP_ENV: env.APP_ENV,
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: env.BETTER_AUTH_URL,
      BETTER_AUTH_TRUSTED_ORIGINS: env.BETTER_AUTH_TRUSTED_ORIGINS,
      GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    }),
  )
  const platform = Layer.mergeAll(
    Layer.succeed(D1, env.DB),
    StorageR2(env.CONTENT),
    WriteLimit.fromBinding(env.WRITE_LIMIT),
    config,
  )
  // Every layer that reads Config (auth) is built here, on the first event, before anything is
  // served: a missing secret fails at once with one logged cause. The HTTP handler reuses these
  // layers through the shared MemoMap; the cron runs on this runtime directly.
  const services = ManagedRuntime.make(
    Layer.mergeAll(HandlersLive, HttpServer.layerServices).pipe(Layer.provide(platform)),
  )
  const ready: Promise<boolean> = services
    .runPromiseExit(Effect.void)
    .then((exit) =>
      Exit.isSuccess(exit)
        ? true
        : Effect.runPromise(Effect.logError("startup failed; check the Worker's settings", exit.cause)).then(
            () => false,
          ),
    )
  const web = HttpRouter.toWebHandler(
    ApiLive.pipe(Layer.provide(platform), Layer.provide(HttpServer.layerServices)),
    {
      memoMap: services.memoMap,
    },
  )
  return {
    ready,
    fetch: (request: Request) => web.handler(request),
    services,
    dispose: () => Promise.allSettled([web.dispose(), services.dispose()]),
  }
}
