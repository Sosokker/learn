// Bindings and vars from wrangler.jsonc; secrets from `wrangler secret put` (or .dev.vars locally).
export interface Env {
  readonly DB: D1Database
  readonly CONTENT: R2Bucket
  // Per-user limit on state-changing API requests (wrangler.jsonc `ratelimits`). Optional: without
  // it nothing is limited.
  readonly WRITE_LIMIT?: RateLimit
  // One Durable Object per AI generation job (GenerationAgent, ADR 0009). Optional so the Worker
  // still serves everything else without it; a job then fails to start.
  readonly GENERATION_AGENT?: DurableObjectNamespace
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
  // AI generation (GenerationSettings in packages/services). The model list is a JSON var; the
  // provider keys and BYOK_KEK are secrets. A provider without a key is offered for BYOK only.
  // A JSON array in wrangler.jsonc (an array here), or a JSON string in .dev.vars.
  readonly GENERATION_MODELS?: string | ReadonlyArray<unknown>
  readonly GENERATION_DAILY_JOBS?: string
  readonly GENERATION_MAX_TURNS?: string
  readonly GENERATION_MAX_OUTPUT_TOKENS?: string
  readonly ANTHROPIC_API_KEY?: string
  readonly OPENAI_API_KEY?: string
  readonly DEEPSEEK_API_KEY?: string
  // 32 random bytes, base64: encrypts users' own provider keys (AES-GCM). Unset: BYOK is off.
  readonly BYOK_KEK?: string
}
