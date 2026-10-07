import { createAuthClient } from "better-auth/react"

// Better Auth runs in the Worker at /api/auth (Google sign-in only). The profile (handle, bio)
// comes from GET /api/me, not from the auth session, so this client is only used to sign in/out.
export const authClient = createAuthClient({ basePath: "/api/auth" })

export async function signInWithGoogle(): Promise<boolean> {
  const result = await authClient.signIn.social({ provider: "google", callbackURL: window.location.href })
  return result.error == null
}

export async function signOut(): Promise<void> {
  await authClient.signOut()
}
