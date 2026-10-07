# 0002: wrangler + the Cloudflare Vite plugin, not Alchemy

**Status:** accepted, 2026-10-07

## Decision
`apps/worker/wrangler.jsonc` describes the Worker, its D1, R2, rate limit, cron and custom domain.
`apps/web` builds the SPA with Vite and runs the Worker inside the dev server through
`@cloudflare/vite-plugin`, so `bun run dev` is the whole app on one origin. Migrations are a
separate `wrangler d1 migrations apply` step before deploy.

## Why
One config file that Cloudflare's own docs describe. No second infrastructure tool to learn, and
local dev uses the same workerd runtime as production.

## Consequences
- Local state (D1, R2) for dev, migrations and the seed all live in `apps/worker/.wrangler/state`.
- One-time resources (`wrangler d1 create`, `wrangler r2 bucket create`, secrets) are manual steps
  in the README instead of code.
- Tests use wrangler's `getPlatformProxy()` for real local bindings.
