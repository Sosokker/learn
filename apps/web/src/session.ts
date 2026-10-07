import { authClient } from "./auth.ts"

// The Better Auth session, reduced to what the app needs. `pending` while the first check runs.
export function useViewer() {
  const session = authClient.useSession()
  const user = session.data?.user ?? null
  return {
    pending: session.isPending,
    user:
      user === null ? null : { id: user.id, name: user.name, email: user.email, image: user.image ?? null },
  }
}
