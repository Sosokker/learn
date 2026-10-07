import { assert, describe, it } from "@effect/vitest"
import { convertV4MiniflareOptions, Miniflare } from "miniflare"
import { edgeCacheKey, handleFetch, isShareable } from "../src/worker.ts"

// The Worker entry itself (worker.ts): startup, liveness and the edge cache key.
describe("worker entry", () => {
  it("keys the edge cache by path only", () => {
    const key = (path: string, init: RequestInit = {}) =>
      edgeCacheKey(new Request(`https://learn.sirin.dev${path}`, init))?.url
    const hash = "a".repeat(64)
    assert.strictEqual(key(`/c/${hash}.json`), `https://learn.sirin.dev/c/${hash}.json`)
    // A query string cannot make a fresh entry (or skip the cached one).
    assert.strictEqual(key(`/c/${hash}.json?bust=1`), `https://learn.sirin.dev/c/${hash}.json`)
    const bundle =
      "/api/lessons/0199c1c0-0000-7000-8000-000000000000/versions/0199c1c0-0000-7000-8000-000000000001/concepts"
    assert.strictEqual(key(`${bundle}?x=y`), `https://learn.sirin.dev${bundle}`)
    // Headers are not part of the key.
    const withCookie = edgeCacheKey(
      new Request(`https://learn.sirin.dev/c/${hash}.json`, { headers: { cookie: "s=1" } }),
    )
    assert.isFalse(withCookie?.headers.has("cookie"))
    assert.isUndefined(key(`/c/${hash}.json`, { method: "POST" }))
    assert.isUndefined(key("/api/lessons/x"))
    assert.isUndefined(key("/api/lessons/x/versions/y/body"))

    const response = (headers: Record<string, string>, status = 200) =>
      new Response("{}", { status, headers })
    assert.isTrue(isShareable(response({ "cache-control": "public, max-age=31536000, immutable" })))
    assert.isFalse(isShareable(response({ "cache-control": "private, no-store" })))
    assert.isFalse(isShareable(response({ "cache-control": "public" }, 404)))
    assert.isFalse(isShareable(response({ "cache-control": "public", "set-cookie": "s=1" })))
  })

  it("answers liveness while misconfigured, and builds again after a failed start", async () => {
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default { fetch: () => new Response(null, { status: 404 }) }",
        compatibilityDate: "2026-09-30",
        d1Databases: ["DB"],
        r2Buckets: ["CONTENT"],
      }),
    )
    try {
      const bindings = await mf.getBindings<{ DB: D1Database; CONTENT: R2Bucket }>()
      const call = (path: string, env: Parameters<typeof handleFetch>[1]) =>
        handleFetch(new Request(`http://localhost:3000${path}`), env, () => undefined)

      // No auth settings: the app cannot start.
      const broken = { DB: bindings.DB, CONTENT: bindings.CONTENT }
      const live = await call("/api/health", broken)
      assert.strictEqual(live.status, 200)
      assert.deepStrictEqual(await live.json(), { status: "ok" })
      assert.strictEqual((await call("/api/health/ready", broken)).status, 503)

      // The settings arrive: the next request builds the app again instead of a cached 503.
      const fixed = {
        ...broken,
        APP_ENV: "test",
        BETTER_AUTH_SECRET: "f/PV4CMPZKwdOG1J+AWa1m2H+XYmlFZpwIlptI9GGVg=",
        BETTER_AUTH_URL: "http://localhost:3000",
        GOOGLE_CLIENT_ID: "test-client-id",
        GOOGLE_CLIENT_SECRET: "test-client-secret",
      }
      assert.strictEqual((await call("/api/health/ready", fixed)).status, 200)
    } finally {
      await mf.dispose()
    }
  })
})
