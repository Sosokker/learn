// Bindings and vars from wrangler.jsonc; secrets from `wrangler secret put` (or .dev.vars locally).
export interface Env {
  readonly DB: D1Database
  readonly CONTENT: R2Bucket
  // Per-user limit on state-changing API requests (wrangler.jsonc `ratelimits`). Optional: without
  // it nothing is limited.
  readonly WRITE_LIMIT?: RateLimit
  // dev | test | deployed (the default). Unlocks the public dev auth secret locally.
  readonly APP_ENV?: string
  readonly BETTER_AUTH_SECRET?: string
  readonly BETTER_AUTH_URL?: string
  readonly BETTER_AUTH_TRUSTED_ORIGINS?: string
  readonly GOOGLE_CLIENT_ID?: string
  readonly GOOGLE_CLIENT_SECRET?: string
  // Comma-separated user ids that may moderate (reports, hiding comments). A secret, so a deploy
  // does not overwrite it. Unset: nobody.
  readonly ADMIN_USER_IDS?: string
}
