// BETTER_AUTH_SECRET rules, checked by packages/auth when the Worker starts. Light on purpose (no
// Better Auth): scripts can import it as `@app/auth/secret`.
import { Result } from "effect"

// Where the app runs. `deployed` is the default everywhere it is read (fail closed); `.dev.vars`
// sets `dev` for `wrangler dev` / Vite and the test runner sets `test`.
export const appEnvs = ["dev", "test", "deployed"] as const
export type AppEnv = (typeof appEnvs)[number]

// Committed to the repo, so anyone can sign tokens with them: allowed only for dev and test.
// The secret signs session cookies; a known one lets an attacker forge a session for any user.
export const devAuthSecret = "SfSS8JhyInf80P43/hKbOuRuL993j5yn4TDlVFK9aYE="
export const testAuthSecret = "f/PV4CMPZKwdOG1J+AWa1m2H+XYmlFZpwIlptI9GGVg="
const publicSecrets = [devAuthSecret, testAuthSecret]
const placeholders = ["replace-with-openssl-rand-base64-32"]
const minBytes = 32

export function checkAuthSecret(secret: string, env: AppEnv): Result.Result<string, string> {
  if (placeholders.includes(secret)) {
    return Result.fail(
      "BETTER_AUTH_SECRET is the .env.example placeholder. Generate one: openssl rand -base64 32",
    )
  }
  if (env === "deployed" && publicSecrets.includes(secret)) {
    return Result.fail("BETTER_AUTH_SECRET is a public dev/test value. Generate one: openssl rand -base64 32")
  }
  if (secretBytes(secret) < minBytes) {
    return Result.fail(
      `BETTER_AUTH_SECRET must hold at least ${minBytes} random bytes: base64 (openssl rand -base64 32) or 64+ hex characters`,
    )
  }
  return Result.succeed(secret)
}

// Bytes the string encodes, read as hex if it is hex, else as base64 or base64url. Length is
// all we can check; entropy is up to whoever generated it.
function secretBytes(secret: string) {
  if (/^[0-9a-fA-F]+$/.test(secret)) return Math.floor(secret.length / 2)
  const body = secret.replace(/={1,2}$/, "")
  const base64 = /^[A-Za-z0-9+/]+$/.test(body) || /^[A-Za-z0-9_-]+$/.test(body)
  if (!base64 || body.length % 4 === 1) return 0
  return Math.floor((body.length * 6) / 8)
}
