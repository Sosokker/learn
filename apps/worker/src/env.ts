import type { D1Database, Fetcher, R2Bucket, RateLimit } from "@cloudflare/workers-types"

export interface Env {
  readonly DB: D1Database
  readonly CONTENT: R2Bucket
  readonly ASSETS?: Fetcher
  readonly WRITE_LIMIT?: RateLimit
  // The public origin. Better Auth builds OAuth redirect URIs from it.
  readonly PUBLIC_URL: string
  readonly BETTER_AUTH_SECRET: string
  readonly GOOGLE_CLIENT_ID: string
  readonly GOOGLE_CLIENT_SECRET: string
}
