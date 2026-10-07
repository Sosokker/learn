# 0002. wrangler + the Cloudflare Vite plugin instead of Alchemy

- Status: accepted
- Date: 2026-10-07

## Context

The template deploys with Alchemy (TypeScript infrastructure, one environment
per customer). This project has one deployment (`learn.sirin.dev`), one Worker,
one D1 database and one R2 bucket. The `sirin.dev` zone is already on
Cloudflare. The user chose wrangler.

## Decision

- One `apps/worker/wrangler.jsonc` declares the Worker, the custom domain, the
  static assets (`../web/dist`), the D1 and R2 bindings, the cron and the vars.
- `apps/web` runs the Worker inside Vite with `@cloudflare/vite-plugin`, so
  `bun run dev` is one command.
- Migrations are their own step: `wrangler d1 migrations apply learn
  --local | --remote`. `bun run deploy` builds, applies remote migrations,
  then runs `wrangler deploy`.
- The D1 database, the R2 bucket and the secrets are made once by hand
  (README, "One-time Cloudflare setup").

## Why

- The official tool, with no extra layer to learn or upgrade.
- One config file that the Vite plugin, `wrangler dev`, Miniflare tests and
  `getPlatformProxy` (the seed script) all read.
- Alchemy's strength (many environments from code) is not needed here.

## Cost

- One-time resources are manual steps, and `database_id` must be pasted into
  `wrangler.jsonc`.
- A second environment (staging) would need wrangler `env` blocks and its own
  database and bucket.
