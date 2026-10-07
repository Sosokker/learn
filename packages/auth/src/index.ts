import { type Drizzle, profile, uuidv7 } from "@app/db"
import { account, session, user, verification } from "@app/db/auth-schema"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { eq, like } from "drizzle-orm"

export interface AuthConfig {
  readonly db: Drizzle
  readonly secret: string
  // The public origin, e.g. https://learn.sirin.dev or http://localhost:5173.
  readonly baseURL: string
  readonly google: { readonly clientId: string; readonly clientSecret: string }
}

// A handle from a name or email: lowercase ASCII, digits, `_` and `-`, 2–30 characters.
export function handleBase(name: string, email: string): string {
  const pick = (s: string) =>
    s
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "")
      .replace(/^[-_]+/, "")
      .slice(0, 24)
  const fromEmail = pick(email.split("@")[0] ?? "")
  const fromName = pick(name)
  const base = fromEmail.length >= 2 ? fromEmail : fromName
  return base.length >= 2 ? base : "user"
}

// The first free handle: `base`, then `base2`, `base3`, … (one indexed query).
async function freeHandle(db: Drizzle, base: string): Promise<string> {
  const taken = new Set(
    (
      await db
        .select({ h: profile.handle })
        .from(profile)
        .where(like(profile.handle, `${base}%`))
    ).map((r) => r.h),
  )
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`
}

// Better Auth with Google sign-in only: no passwords (no hashing on Worker CPU) and no email.
// `cookieCache` keeps a signed copy of the session in a cookie for 5 minutes, so most signed-in
// requests don't read the session table.
export function makeAuth(config: AuthConfig) {
  const { db } = config
  return betterAuth({
    secret: config.secret,
    baseURL: config.baseURL,
    basePath: "/api/auth",
    database: drizzleAdapter(db, { provider: "sqlite", schema: { user, session, account, verification } }),
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: config.google.clientId,
        clientSecret: config.google.clientSecret,
        prompt: "select_account",
      },
    },
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
    advanced: { database: { generateId: () => uuidv7() } },
    databaseHooks: {
      user: {
        create: {
          // Every user gets a profile with a unique handle (learn.sirin.dev/@handle) on first sign-in.
          after: async (u) => {
            const existing = await db.select().from(profile).where(eq(profile.userId, u.id)).limit(1)
            if (existing.length > 0) return
            const handle = await freeHandle(db, handleBase(u.name, u.email))
            await db.insert(profile).values({ userId: u.id, handle }).onConflictDoNothing()
          },
        },
      },
    },
  })
}

export type Auth = ReturnType<typeof makeAuth>
