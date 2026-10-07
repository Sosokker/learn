// The public profile every user gets on first sign-in: a unique handle for learn.sirin.dev/@handle.
// Runs inside Better Auth's user-create hook, so it uses the D1 binding directly.
import { isReservedHandle } from "@app/api"

// RFC 4648 base32, lowercased: only letters and digits a handle allows.
const base32 = "abcdefghijklmnopqrstuvwxyz234567"

const randomBase32 = (length: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(length)), (byte) => base32[byte % 32] ?? "a").join("")

// A neutral handle the user can change later (PATCH /api/me): lowercase ASCII letters, digits and
// `_` from the display name, 2–20 characters. The email is never used, so a handle never
// publishes an address. A name with no Latin letters (e.g. a Thai name) gets `user_<6 base32>`.
export const handleBase = (name: string): string => {
  const fromName = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20)
    .replace(/_+$/g, "")
  if (fromName.length < 2) return `user_${randomBase32(6)}`
  return isReservedHandle(fromName) ? `${fromName}_1` : fromName
}

const suffix = () => String(1000 + ((crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % 9000))

// Idempotent: a second call (or a racing sign-in) leaves the first profile alone. `insert or
// ignore` skips a taken handle and an existing profile alike; the loop tells them apart.
export async function ensureProfile(
  db: D1Database,
  user: { readonly id: string; readonly name: string },
): Promise<string> {
  const base = handleBase(user.name)
  const tries = [base, ...Array.from({ length: 8 }, () => `${base.slice(0, 24)}_${suffix()}`)]
  for (const handle of tries) {
    const existing = await db
      .prepare("select handle from profile where user_id = ?")
      .bind(user.id)
      .first<{ handle: string }>()
    if (existing !== null) return existing.handle
    const inserted = await db
      .prepare("insert or ignore into profile (user_id, handle, created_at) values (?, ?, ?)")
      .bind(user.id, handle, Date.now())
      .run()
    if (inserted.meta.changes === 1) return handle
  }
  throw new Error(`could not find a free handle for user ${user.id}`)
}
