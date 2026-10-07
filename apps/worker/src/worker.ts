import { Lessons as LessonsTag, recomputeHotScores } from "@app/services"
import type { ExecutionContext, ScheduledController } from "@cloudflare/workers-types"
import { Effect } from "effect"
import { type App, makeApp } from "./app.ts"
import type { Env } from "./env.ts"

let app: App | undefined
let appEnv: Env | undefined
const getApp = (env: Env) => {
  if (app === undefined || appEnv !== env) {
    app = makeApp(env)
    appEnv = env
  }
  return app
}

// Anonymous GETs worth caching at the edge (the Cache API needs the custom domain). Signed-in
// responses can differ per user, so they always reach the Worker.
const edgeCached: ReadonlyArray<readonly [RegExp, number]> = [
  [/^\/api\/feed$/, 60],
  [/^\/api\/categories$/, 3600],
  [/^\/api\/lessons\/@[^/]+\/[^/]+$/, 60],
  [/^\/api\/concepts(\/[^/]+)?$/, 300],
  // A version's concept bundle never changes, and concepts are public.
  [/^\/api\/versions\/[^/]+\/concepts$/, 31_536_000],
]

const isAnonymous = (req: Request) =>
  !req.headers.has("authorization") &&
  !/(?:^|;\s*)(?:__Secure-)?better-auth\./.test(req.headers.get("cookie") ?? "")

async function withEdgeCache(
  req: Request,
  ctx: ExecutionContext,
  run: () => Promise<Response>,
): Promise<Response> {
  const path = new URL(req.url).pathname
  const rule = edgeCached.find(([re]) => re.test(path))
  const caches = (globalThis as { caches?: { default?: Cache } }).caches
  const cache = caches?.default
  if (req.method !== "GET" || rule === undefined || cache === undefined || !isAnonymous(req)) return run()
  const key = new Request(req.url)
  const hit = await cache.match(key)
  if (hit) return hit
  const res = await run()
  if (res.status !== 200) return res
  const cached = new Response(res.body, res)
  cached.headers.set("Cache-Control", `public, max-age=${rule[1]}`)
  ctx.waitUntil(cache.put(key, cached.clone()))
  return cached
}

// /c/<sha256>.json: an immutable lesson or concept body. Served only if some public or unlisted
// lesson (or any concept) has that hash; private bodies go through the owner-checked API.
async function serveContent(req: Request, env: Env, ctx: ExecutionContext, a: App): Promise<Response> {
  const hash = /^\/c\/([0-9a-f]{64})\.json$/.exec(new URL(req.url).pathname)?.[1]
  if (hash === undefined || req.method !== "GET") return new Response("not found", { status: 404 })
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default
  const key = new Request(req.url)
  const hit = await cache?.match(key)
  if (hit) return hit
  const allowed = await Effect.runPromise(
    Effect.flatMap(Effect.service(LessonsTag), (l) => l.isPublicHash(hash)).pipe(Effect.provide(a.services)),
  )
  if (!allowed) return new Response("not found", { status: 404 })
  const obj = await env.CONTENT.get(`c/${hash}.json`)
  if (obj === null) return new Response("not found", { status: 404 })
  const res = new Response(await obj.text(), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"${hash}"`,
    },
  })
  if (cache) ctx.waitUntil(cache.put(key, res.clone()))
  return res
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const a = getApp(env)
    const path = new URL(req.url).pathname
    if (path.startsWith("/api/auth/")) return a.auth.handler(req)
    if (path.startsWith("/c/")) return serveContent(req, env, ctx, a)
    if (path.startsWith("/api/")) {
      if (req.method !== "GET" && env.WRITE_LIMIT) {
        // Keyed by credential (token or session cookie), so one busy user doesn't block a shared IP.
        const key =
          req.headers.get("authorization") ?? req.headers.get("cookie") ?? req.headers.get("cf-connecting-ip")
        const { success } = await env.WRITE_LIMIT.limit({ key: (key ?? "anon").slice(-64) })
        if (!success) return Response.json({ _tag: "TooManyRequests", message: "slow down" }, { status: 429 })
      }
      return withEdgeCache(req, ctx, () => a.handler(req))
    }
    // Static assets are served before the Worker runs; this is only reached without them.
    return env.ASSETS
      ? (env.ASSETS.fetch(req as never) as unknown as Promise<Response>)
      : new Response("not found", { status: 404 })
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const a = getApp(env)
    const run = Effect.runPromise(recomputeHotScores().pipe(Effect.provide(a.services), Effect.asVoid))
    ctx.waitUntil(run)
    await run
  },
}
