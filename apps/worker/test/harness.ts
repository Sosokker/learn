import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { newApiToken, sha256Hex, uuidv7 } from "@app/db"
import type { D1Database, ExecutionContext } from "@cloudflare/workers-types"
import { getPlatformProxy } from "wrangler"
import type { Env } from "../src/env.ts"
import worker from "../src/worker.ts"

const root = join(import.meta.dirname, "../../..")
export const readJson = (path: string): unknown => JSON.parse(readFileSync(join(root, path), "utf8"))

export async function migrate(db: D1Database) {
  const dir = join(root, "packages/db/migrations")
  for (const f of readdirSync(dir).sort()) {
    const sql = readFileSync(join(dir, f), "utf8").replace(/^--.*$/gm, "")
    for (const stmt of sql
      .split(/;\s*$/m)
      .map((s) => s.trim())
      .filter(Boolean))
      await db.prepare(stmt).run()
  }
}

// A fresh, in-memory D1 + R2 with all migrations applied.
export async function makeEnv() {
  const proxy = await getPlatformProxy<Env>({
    configPath: join(root, "apps/worker/wrangler.jsonc"),
    persist: false,
  })
  // No rate limit in tests: they write much faster than a person.
  const { WRITE_LIMIT: _limit, ...bindings } = proxy.env
  const env: Env = {
    ...bindings,
    PUBLIC_URL: "http://localhost:8787",
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
    GOOGLE_CLIENT_ID: "test",
    GOOGLE_CLIENT_SECRET: "test",
  }
  await migrate(env.DB)
  return { env, dispose: () => proxy.dispose() }
}

// A user who signed in with Google, plus an API token to act as them.
export async function makeUser(env: Env, handle: string) {
  const id = uuidv7()
  const now = Date.now()
  await env.DB.prepare(
    "insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)",
  )
    .bind(id, handle, `${handle}@example.com`, now, now)
    .run()
  await env.DB.prepare("insert into profile (user_id, handle) values (?, ?)").bind(id, handle).run()
  const token = newApiToken()
  await env.DB.prepare("insert into api_token (id, user_id, hash, name, created_at) values (?, ?, ?, ?, ?)")
    .bind(uuidv7(), id, await sha256Hex(token), "test", now)
    .run()
  return { id, handle, token }
}

export const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext

// Calls the Worker the way a browser or pi would.
export function client(env: Env, token?: string) {
  const call = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = {}
    if (token) headers.authorization = `Bearer ${token}`
    if (body !== undefined) headers["content-type"] = "application/json"
    const res = await worker.fetch(
      new Request(`http://localhost${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      ctx,
    )
    const text = await res.text()
    let json: unknown = null
    try {
      json = text === "" ? null : JSON.parse(text)
    } catch {
      json = text
    }
    // biome-ignore lint/suspicious/noExplicitAny: test responses are inspected loosely
    return { status: res.status, json: json as any }
  }
  return {
    get: (path: string) => call("GET", path),
    post: (path: string, body: unknown) => call("POST", path, body),
    patch: (path: string, body: unknown) => call("PATCH", path, body),
    del: (path: string) => call("DELETE", path),
  }
}
