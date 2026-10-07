import { createAuthClient } from "better-auth/react"

// Better Auth runs in the same Worker at /api/auth (Google only). The session is a same-origin
// cookie, so the typed HttpApi client needs no auth code of its own.
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/api/auth",
})

// Starts Google sign-in and comes back to the current page. Better Auth resolves to
// `{ data, error }` instead of rejecting; turn the error into a rejection for callers.
export async function signInWithGoogle() {
  const result = await authClient.signIn.social({ provider: "google", callbackURL: window.location.href })
  if (result.error !== null) throw new Error(result.error.message ?? "sign-in failed")
}
