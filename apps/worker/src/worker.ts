import { Database } from "@app/db"
import { HotScore, LessonSearch, repairConceptFts } from "@app/services"
import { Effect, Exit, Layer, ManagedRuntime } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import type { Env } from "./env.ts"
import { ApiLive, HandlersLive } from "./http.ts"
import { storageLayer, writeLimitLayer } from "./platform.ts"

export type { Env } from "./env.ts"

// Static assets (the web SPA) are served before the Worker runs; only /api/* and /c/* reach
// `fetch` (assets.run_worker_first).

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
// bodies only. Not the concept bundle of a lesson version (/api/lessons/:id/versions/:vid/concepts):
// its path names the lesson, so a cached copy would keep answering 200 after the lesson turns
// private or is deleted, and private must be 404 (ADR 0003). The concepts in it are public, but
// which ones a lesson pins, and its card ids, are the lesson's. Each request checks access (a few
// index reads, plus one R2 read per pinned concept).
const edgeCached = /^\/c\//

// The edge cache key of a request, or undefined when it is not cached. The key is the path alone,
// so a query string or a header (a cookie) cannot make a new entry or skip the cached one.
export const edgeCacheKey = (request: Request): Request | undefined => {
  const url = new URL(request.url)
  if (request.method !== "GET" || !edgeCached.test(url.pathname)) return undefined
  return new Request(`${url.origin}${url.pathname}`, { method: "GET" })
}

// Security headers on every response the Worker makes (/api/*, /c/*): JSON, JSON bodies and
// auth redirects, so the policy allows almost nothing. Inline styles stay allowed for Better
// Auth's own error page (/api/auth/error). The SPA is served as static assets without running the
// Worker, so its policy is in apps/web/public/_headers.
export const securityHeaders: Readonly<Record<string, string>> = {
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
}

const withSecurityHeaders = (response: Response): Response => {
  // A copy: responses from the cache and from fetch have immutable headers.
  const secured = new Response(response.body, response)
  for (const [name, value] of Object.entries(securityHeaders)) {
    if (!secured.headers.has(name)) secured.headers.set(name, value)
  }
  return secured
}

// The Worker's fetch, with `waitUntil` passed alone so tests can call it.
export async function handleFetch(
  request: Request,
  env: Env,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<Response> {
  return withSecurityHeaders(await route(request, env, waitUntil))
}

async function route(
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
  // Cron Trigger (*/30): recompute hot scores of lessons made public in the last 14 days (an index
  // range on each table, see HotScore); fill the search text of up to 50 lesson languages from
  // before migration 0007 (none once it has caught up; a read of an empty partial index), in
  // batches of at most 125 statements; and repair concept_fts rows an older Worker wrote during a
  // deploy (two index reads when there is nothing to do).
  scheduled(controller, env, ctx) {
    ctx.waitUntil(
      appFor(env).then((current) =>
        current?.services.runPromise(
          Effect.all([
            HotScore.use((hot) => hot.recompute(controller.scheduledTime)),
            LessonSearch.use((search) => search.backfill(50)),
            Database.use(repairConceptFts),
          ]),
        ),
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
  const platform = Layer.mergeAll(storageLayer(env), writeLimitLayer(env))
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
