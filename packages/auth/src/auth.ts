import { platformUserId } from "@app/api"
import { D1, uuidv7 } from "@app/db"
import { betterAuth } from "better-auth"
import { Config, ConfigProvider, Context, Effect, Layer, Option, Redacted, Schema } from "effect"
import { ensureProfile } from "./profile.ts"
import { appEnvs, checkAuthSecret } from "./secret.ts"

export class AuthError extends Schema.TaggedError<AuthError>()("AuthError", { cause: Schema.Defect() }) {}

export type AuthInstance = ReturnType<typeof makeAuth>

// Better Auth, Google sign-in only, on D1. It gets the D1 binding itself: Better Auth 1.7 detects
// a D1 binding and uses its built-in Kysely D1 dialect (no Drizzle adapter, no extra driver). D1
// has no interactive transactions, which Better Auth knows and does without. One instance per
// isolate: the binding outlives requests, unlike the template's Postgres sockets.
export class Auth extends Context.Service<
  Auth,
  {
    readonly use: <A>(f: (auth: AuthInstance) => Promise<A>) => Effect.Effect<A, AuthError>
    // Origins the app is served from (BETTER_AUTH_URL plus BETTER_AUTH_TRUSTED_ORIGINS). The API
    // refuses state-changing session requests from any other origin.
    readonly appOrigins: ReadonlyArray<string>
  }
>()("@app/auth/Auth") {
  static readonly layer = Layer.effect(
    Auth,
    Effect.gen(function* () {
      const d1 = yield* D1
      const settings = yield* readSettings
      const auth = makeAuth(d1, settings)
      // Better Auth initializes asynchronously; finish it while the layer is built, so a broken
      // setup fails the Worker's startup instead of the first sign-in.
      yield* Effect.tryPromise({ try: () => auth.$context, catch: (cause) => new AuthError({ cause }) }).pipe(
        Effect.orDie,
      )
      return Auth.of({
        use: Effect.fn("Auth.use")(function* <A>(f: (auth: AuthInstance) => Promise<A>) {
          return yield* Effect.tryPromise({ try: () => f(auth), catch: (cause) => new AuthError({ cause }) })
        }),
        appOrigins: [
          ...Option.match(settings.baseURL, { onNone: () => [], onSome: (url) => [new URL(url).origin] }),
          ...settings.trustedOrigins,
        ],
      })
    }),
  )
}

const readSettings = Effect.gen(function* () {
  const appEnv = yield* Config.Literals(appEnvs, "APP_ENV").pipe(Config.withDefault("deployed"))
  return {
    // Signs session cookies and encrypts stored OAuth tokens. The public dev/test values are
    // refused unless APP_ENV is dev or test.
    secret: yield* Config.Redacted("BETTER_AUTH_SECRET").pipe(
      Config.mapEffect((secret) =>
        Effect.fromResult(checkAuthSecret(Redacted.value(secret), appEnv)).pipe(
          Effect.as(secret),
          Effect.mapError((message) => new Config.ConfigError(new ConfigProvider.SourceError({ message }))),
        ),
      ),
    ),
    // The public origin (https://learn.sirin.dev); Google's redirect URI is built from it:
    // <BETTER_AUTH_URL>/api/auth/callback/google.
    baseURL: yield* Config.option(Config.String("BETTER_AUTH_URL")),
    // Extra origins allowed to call /api/auth (the Vite dev server). Comma-separated.
    trustedOrigins: yield* Config.String("BETTER_AUTH_TRUSTED_ORIGINS").pipe(
      Config.map((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter((origin) => origin !== ""),
      ),
      Config.withDefault<Array<string>>([]),
    ),
    googleClientId: yield* Config.String("GOOGLE_CLIENT_ID"),
    googleClientSecret: yield* Config.Redacted("GOOGLE_CLIENT_SECRET"),
    // Cloudflare sets cf-connecting-ip and a client cannot override it.
    ipAddressHeader: yield* Config.String("AUTH_IP_HEADER").pipe(Config.withDefault("cf-connecting-ip")),
  }
})

export type Settings = Effect.Success<typeof readSettings>

export function makeAuth(
  d1: D1Database,
  settings: Settings,
  options: { readonly validateSchema?: boolean } = {},
) {
  return betterAuth({
    secret: Redacted.value(settings.secret),
    ...Option.match(settings.baseURL, { onNone: () => ({}), onSome: (baseURL) => ({ baseURL }) }),
    basePath: "/api/auth",
    trustedOrigins: settings.trustedOrigins,
    telemetry: { enabled: false },
    database: d1,
    advanced: {
      // validateSchema: off, because it introspects every auth table on every isolate start (D1
      // rows read on each cold start). apps/worker/test/auth.test.ts runs the same check against
      // the migrated schema instead.
      database: { generateId: () => uuidv7(), validateSchema: options.validateSchema ?? false },
      ipAddress: { ipAddressHeaders: [settings.ipAddressHeader] },
    },
    socialProviders: {
      google: {
        clientId: settings.googleClientId,
        clientSecret: Redacted.value(settings.googleClientSecret),
        // Ask Google for the account chooser each time, so a shared computer can switch accounts.
        prompt: "select_account",
      },
    },
    // No passwords: no hashing on Worker CPU and no email service for resets.
    emailAndPassword: { enabled: false },
    // Rate limits are off unless NODE_ENV is production and live in one isolate's memory by
    // default. Always on here, in D1, so every isolate shares them.
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rate_limit",
      fields: { lastRequest: "last_request" },
      customRules: {
        "/sign-in/*": { window: 60, max: 10 },
        // Read on every page load; a session token is not guessable, so skip the counter write.
        "/get-session": false,
      },
    },
    session: {
      // A signed session copy in a cookie for 5 minutes: most signed-in requests read no D1 row.
      // Sign-out elsewhere takes up to 5 minutes to reach a browser that holds the cookie.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
      fields: snakeCase(["expiresAt", "createdAt", "updatedAt", "ipAddress", "userAgent", "userId"]),
    },
    user: { fields: snakeCase(["emailVerified", "createdAt", "updatedAt"]) },
    account: {
      // Google's access and refresh tokens are stored encrypted with BETTER_AUTH_SECRET. Rows
      // written before this was on stay readable (plain tokens pass through) until the next sign-in
      // rewrites them.
      encryptOAuthTokens: true,
      // One provider (Google), so linking is never needed. Off, a Google sign-in whose email
      // matches an existing user without that Google account is refused instead of attached to it
      // (the platform user `learn` has an email but no Google account).
      accountLinking: { enabled: false, disableImplicitLinking: true },
      fields: snakeCase([
        "accountId",
        "providerId",
        "userId",
        "accessToken",
        "refreshToken",
        "idToken",
        "accessTokenExpiresAt",
        "refreshTokenExpiresAt",
        "createdAt",
        "updatedAt",
      ]),
    },
    verification: { fields: snakeCase(["expiresAt", "createdAt", "updatedAt"]) },
    databaseHooks: {
      user: {
        create: {
          // Every user gets a public profile with a unique handle on first sign-in.
          after: async (user) => {
            await ensureProfile(d1, { id: user.id, name: user.name })
          },
        },
      },
      account: {
        create: {
          // The platform account never gets a login, whatever the linking settings.
          before: async (account) => (account.userId === platformUserId ? false : undefined),
        },
      },
      session: {
        create: {
          before: async (session) => (session.userId === platformUserId ? false : undefined),
          // D1 has no transaction around user + hook: if the hook above failed after the user row
          // was written, the next sign-in repairs it. One indexed read when the profile exists.
          after: async (session) => {
            const user = await d1
              .prepare("select id, name from user where id = ?")
              .bind(session.userId)
              .first<{ id: string; name: string }>()
            if (user !== null) await ensureProfile(d1, user)
          },
        },
      },
    },
  })
}

// Better Auth names fields in camelCase; our columns are snake_case.
function snakeCase<const Field extends string>(fields: ReadonlyArray<Field>) {
  return Object.fromEntries(
    fields.map((field) => [field, field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)]),
  ) as Record<Field, string>
}
