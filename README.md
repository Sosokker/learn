# Learn

Interactive lessons you can explore, and a community to share them.
Parts you can hover, cards you can drill into, steps with "why" and "why not",
proofs line by line, live widgets, and `@ref`s you can ask about.
English and Thai from the start.

Live at https://learn.sirin.dev. It runs on Cloudflare only: one Worker, D1 for
metadata, R2 for lesson bodies.

- Design: [docs/design.md](docs/design.md)
- Decisions: [docs/adr/](docs/adr/)
- UI style: [docs/linear-DESIGN.md](docs/linear-DESIGN.md)
- Working on the code (people and coding agents): [AGENTS.md](AGENTS.md)

## Stack

Bun workspaces · TypeScript · Effect 4 (`HttpApi`, Schema) · Drizzle (SQL
builder) + `@effect/sql-d1` · Better Auth (Google) · React + Vite · TanStack
Router / Query · Base UI + Tailwind v4 · KaTeX · React Flow + dagre ·
Cloudflare Workers, D1, R2 · wrangler + `@cloudflare/vite-plugin` · Vitest +
Miniflare · Playwright · Biome

## Prerequisites

- Bun 1.4 or newer (`packageManager` is `bun@1.4.0`).
- For sign-in: a Google OAuth client (see "Google sign-in").
- For deploy: a Cloudflare account with the `sirin.dev` zone, and
  `bunx wrangler login`.

## Run locally

```bash
bun install
cp apps/worker/.dev.vars.example apps/worker/.dev.vars   # then fill in the Google values
bun run db:migrate:local   # apply D1 migrations to the local state
bun run seed:local         # shared concepts + the "Start here" guide, owned by @learn
bun run dev                # Vite + the Worker in one process
```

Open http://localhost:5187.

- Local D1 and R2 state lives in `apps/worker/.wrangler/state`. `db:migrate:local`,
  `seed:local` and `bun run dev` all use that directory.
- `seed:local` also applies migrations first, and it is safe to run again.
- The local Worker refuses state-changing requests from other origins. Keep
  the dev server on the port in `BETTER_AUTH_URL`.

### `.dev.vars`

`apps/worker/.dev.vars` holds local settings and secrets. It is gitignored.
Start from `apps/worker/.dev.vars.example`.

| Variable | Local value |
|---|---|
| `APP_ENV` | `dev`. This allows the public dev auth secret. Deployed Workers refuse it. |
| `BETTER_AUTH_SECRET` | The dev secret from the example file is fine locally. |
| `BETTER_AUTH_URL` | `http://localhost:5187` |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Optional. Extra origins, comma-separated. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | From your Google OAuth client |

The Worker reads its settings when it gets its first request. If a value is
missing or wrong, it answers 503 and logs one cause.

## Commands

| Command | What it does |
|---|---|
| `bun run dev` | Vite with HMR, with the Worker, D1 and R2 inside it |
| `bun run typecheck` | Type-check every package |
| `bun run lint` / `bun run format` | Biome check / fix |
| `bun run test` | Every package's tests (domain, lesson renderer, Worker on Miniflare) |
| `bun run test:e2e` | Playwright |
| `bun run db:generate` | Make a migration from schema changes, then flatten it for wrangler |
| `bun run db:migrate:local` | Apply migrations to the local D1 |
| `bun run seed:local` | Seed local content |
| `bun run build` | Build the SPA, then dry-run bundle the Worker |
| `bun run deploy` | Build, apply remote migrations, deploy |

Run one package's tests with `bun run --cwd packages/domain test` (or
`apps/worker`, `packages/lesson`).

## Google sign-in

Sign-in uses Better Auth with Google only. Better Auth is mounted at
`/api/auth`, so the callback path is `/api/auth/callback/google`.

1. In Google Cloud console, go to APIs & Services > Credentials > Create
   credentials > OAuth client ID. Choose "Web application".
2. Add these authorized redirect URIs:
   - `http://localhost:5187/api/auth/callback/google` (local)
   - `https://learn.sirin.dev/api/auth/callback/google` (deployed)
3. Put the client ID and secret in `apps/worker/.dev.vars` for local use, and
   in Worker secrets for the deployed site (below).

## One-time Cloudflare setup

Do these once, from `apps/worker`:

```bash
cd apps/worker
bunx wrangler login
bunx wrangler d1 create learn            # copy the database_id it prints
bunx wrangler r2 bucket create learn-content
```

1. Put the `database_id` into `apps/worker/wrangler.jsonc`
   (`d1_databases[0].database_id`). It is a placeholder of zeros now.
2. Set the secrets:

   ```bash
   openssl rand -base64 32 | bunx wrangler secret put BETTER_AUTH_SECRET
   bunx wrangler secret put GOOGLE_CLIENT_ID
   bunx wrangler secret put GOOGLE_CLIENT_SECRET
   ```

   `BETTER_AUTH_URL` is a var in `wrangler.jsonc` (`https://learn.sirin.dev`).
   `APP_ENV` is unset in production, which means `deployed`.
3. Custom domain: `wrangler.jsonc` has
   `routes: [{ "pattern": "learn.sirin.dev", "custom_domain": true }]`. The first
   deploy creates the DNS record and the certificate, because the `sirin.dev`
   zone is in the same account. The edge cache for `/c/` works only on the
   custom domain, not on `workers.dev`.

## Deploy

```bash
bun run deploy
```

This builds the SPA and the Worker, runs
`wrangler d1 migrations apply learn --remote`, then `wrangler deploy`.
Migrations always run before the new code.

After the first deploy, seed the deployed site with the platform guide and shared
concepts (`content/`, as `@learn`):

```bash
bun run seed:remote --dry-run   # print the SQL and R2 objects it would write
bun run seed:remote
```

It uses your `wrangler login`, reads the remote rows, and runs the same
publish code as the API. Run it again after you change `content/`: it writes
only what changed, and prints "up to date" when nothing did. `seed:local`
does the same for local state.
