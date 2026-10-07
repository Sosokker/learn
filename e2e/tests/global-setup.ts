import { execSync } from "node:child_process"
import { createHmac, randomBytes } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { getPlatformProxy } from "wrangler"

const root = join(import.meta.dirname, "../..")
export const sessionFile = join(import.meta.dirname, "../artifacts/session.json")

// Better Auth signs its session cookie as `token.base64(HMAC-SHA256(secret, token))`.
function signedCookie(token: string, secret: string) {
  const sig = createHmac("sha256", secret).update(token).digest("base64")
  return encodeURIComponent(`${token}.${sig}`)
}

export default async function globalSetup() {
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false" }
  execSync("bun run db:migrate:local", { cwd: root, stdio: "ignore", env })
  execSync("bun run seed:local", { cwd: root, stdio: "ignore", env })

  mkdirSync(join(import.meta.dirname, "../artifacts"), { recursive: true })
  const vars = readFileSync(join(root, "apps/worker/.dev.vars"), "utf8")
  const secret = /^BETTER_AUTH_SECRET=(.*)$/m.exec(vars)?.[1]?.trim()
  if (!secret) throw new Error("apps/worker/.dev.vars has no BETTER_AUTH_SECRET")

  // A user who "signed in with Google": the same rows Better Auth writes, plus a live session.
  const proxy = await getPlatformProxy<{ DB: import("@cloudflare/workers-types").D1Database }>({
    configPath: join(root, "apps/worker/wrangler.jsonc"),
    persist: { path: join(root, "apps/worker/.wrangler/state/v3") },
  })
  const db = proxy.env.DB
  const now = Date.now()
  const userId = "00000000-0000-7000-8000-00000000e2e0"
  const token = randomBytes(24).toString("hex")
  await db.batch([
    db
      .prepare(
        "insert or ignore into user (id, name, email, email_verified, created_at, updated_at) values (?, 'E2E Tester', 'e2e@example.com', 1, ?, ?)",
      )
      .bind(userId, now, now),
    db.prepare("insert or ignore into profile (user_id, handle) values (?, 'e2e')").bind(userId),
    db
      .prepare(
        "insert into session (id, expires_at, token, created_at, updated_at, user_id) values (?, ?, ?, ?, ?, ?)",
      )
      .bind(randomBytes(8).toString("hex"), now + 86_400_000, token, now, now, userId),
  ])
  await proxy.dispose()
  writeFileSync(
    sessionFile,
    JSON.stringify({ name: "better-auth.session_token", value: signedCookie(token, secret), userId }),
  )
}
