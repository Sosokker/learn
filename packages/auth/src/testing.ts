// Test helper: a signed-in user without Google. Creates the user through Better Auth's own
// adapter (so the profile hook runs, as on a real first sign-in), opens a session, and signs the
// session cookie with the configured secret, as Better Auth does after the OAuth callback.
// Only test code imports this (`@app/auth/testing`).
import { makeSignature } from "better-auth/crypto"
import { Option, Redacted } from "effect"
import { type AuthInstance, makeAuth } from "./auth.ts"

export async function createTestSession(
  auth: AuthInstance,
  user: { readonly name: string; readonly email: string },
) {
  const context = await auth.$context
  // The same call the Google callback makes for a new user.
  const created = await context.internalAdapter.createOAuthUser(
    { name: user.name, email: user.email, emailVerified: true },
    { providerId: "google", accountId: `test-${crypto.randomUUID()}` },
  )
  const session = await context.internalAdapter.createSession(created.user.id)
  const signature = await makeSignature(session.token, context.secret)
  const cookie = `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${signature}`)}`
  return { user: created.user, cookie }
}

// Better Auth's own schema check (off in the Worker; see auth.ts) against a migrated database:
// resolves when every table, column and index Better Auth expects is there.
export async function checkAuthSchema(d1: D1Database) {
  const instance = makeAuth(
    d1,
    {
      secret: Redacted.make("f/PV4CMPZKwdOG1J+AWa1m2H+XYmlFZpwIlptI9GGVg="),
      baseURL: Option.none(),
      trustedOrigins: [],
      googleClientId: "schema-check",
      googleClientSecret: Redacted.make("schema-check"),
      ipAddressHeader: "cf-connecting-ip",
    },
    { validateSchema: true },
  )
  const context = await instance.$context
  if (context.checkSchema === undefined)
    throw new Error("Better Auth offers no schema check for this adapter")
  await context.checkSchema()
}
