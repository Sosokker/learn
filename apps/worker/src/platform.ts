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
      GENERATION_MODELS:
        env.GENERATION_MODELS === undefined || typeof env.GENERATION_MODELS === "string"
          ? env.GENERATION_MODELS
          : JSON.stringify(env.GENERATION_MODELS),
      GENERATION_DAILY_JOBS: env.GENERATION_DAILY_JOBS,
      GENERATION_MAX_TURNS: env.GENERATION_MAX_TURNS,
      GENERATION_MAX_OUTPUT_TOKENS: env.GENERATION_MAX_OUTPUT_TOKENS,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY,
      BYOK_KEK: env.BYOK_KEK,
    }),
  )

// D1, R2 and settings: what the services stand on, in the Worker and in a job's Durable Object.
export const storageLayer = (env: Env) =>
  Layer.mergeAll(Layer.succeed(D1, env.DB), StorageR2(env.CONTENT), configLayer(env))

export const writeLimitLayer = (env: Env) => WriteLimit.fromBinding(env.WRITE_LIMIT)
