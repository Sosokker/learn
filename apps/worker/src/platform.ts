import { D1 } from "@app/db"
import { ConfigProvider, Layer } from "effect"
import type { Env } from "./env.ts"
import { WriteLimit } from "./rate-limit.ts"
import { StorageR2 } from "./storage-r2.ts"

// Settings the app reads with Config, from the Worker's vars and secrets. Every new one goes in
// Env, here, .dev.vars.example, and wrangler.jsonc (var) or the README's secret list.
export const configLayer = (env: Env) =>
  ConfigProvider.layer(
    ConfigProvider.fromUnknown({
      APP_ENV: env.APP_ENV,
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: env.BETTER_AUTH_URL,
      BETTER_AUTH_TRUSTED_ORIGINS: env.BETTER_AUTH_TRUSTED_ORIGINS,
      GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
      ADMIN_USER_IDS: env.ADMIN_USER_IDS,
    }),
  )

// D1, R2 and settings: what the services stand on.
export const storageLayer = (env: Env) =>
  Layer.mergeAll(Layer.succeed(D1, env.DB), StorageR2(env.CONTENT), configLayer(env))

export const writeLimitLayer = (env: Env) => WriteLimit.fromBinding(env.WRITE_LIMIT)
