# Learn

[![CI](https://github.com/Sosokker/learn/actions/workflows/ci.yml/badge.svg)](https://github.com/Sosokker/learn/actions/workflows/ci.yml)

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
| `ADMIN_USER_IDS` | Optional. User ids that may moderate (reports, hiding comments), comma-separated. Empty: nobody. |

The Worker reads its settings when it gets its first request. If a required
value is missing or wrong, it answers 503 and logs one cause.

### Create lessons with your agent

The platform does not run an LLM and does not store provider keys (ADR 0010).
The learner's own harness — Claude Code, OpenCode, Codex or pi — writes the
lesson, and Learn validates and publishes it.

1. Sign in, open **Create a lesson**, create an API token in Settings, and copy
   it once.
2. Download the CLI and write the skill into your harness:

```sh
curl -fsSL http://localhost:5187/agent/learn.mjs -o learn.mjs
node learn.mjs init claude        # or opencode, codex, pi, generic
export LEARN_TOKEN=lrn_...
```

`init` writes `.claude/skills/learn/SKILL.md`, `.opencode/skills/learn/SKILL.md`
or `.learn/SKILL.md` (plus an `AGENTS.md` pointer for Codex and pi). The skill
is public at `/agent/SKILL.md`; the LessonSpec JSON Schema is public at
`/api/agent/lesson-schema`.
3. Ask your agent to write the lesson. It writes `en.json` and `th.json`,
   validates them, and publishes a private draft:

```sh
node learn.mjs guide > guide.en.json       # the canonical example
node learn.mjs validate path/to/lesson/    # no writes
node learn.mjs publish path/to/lesson/     # checks the set, writes it in one batch
```

The publish output gives the preview URL (`/@handle/slug`). Change visibility
in Library. The raw API is `POST /api/me/lessons/<slug>/validate` for the dry
run and `POST /api/me/lessons/<slug>/publish` for publish, both with
`Authorization: Bearer <token>`. The publish body is
`{ "specs": [en, th] }`; the server checks the whole set and writes every new
version in one D1 batch, so a second language cannot leave a half-published
lesson. `POST /api/me/lessons/<slug>/versions` remains as the old
single-language adapter for downloaded clients.

### Publish from the repo (pi)

`scripts/publish.ts` is the repo-local path. It parses the files, then asks the
server for the same whole-set check that publish runs, so `--dry-run` needs a
token exactly like a real publish. Use it when you work inside this repository;
external harnesses use the single-file CLI above.

```sh
export LEARN_TOKEN=lrn_...
bun scripts/publish.ts path/to/lesson.json            # one language
bun scripts/publish.ts path/to/lesson/                # en.json + th.json
bun scripts/publish.ts path/to/lesson/ --dry-run      # validate only
bun scripts/publish.ts lesson.json --slug my-lesson --url http://localhost:5187
```

The raw API is `POST /api/me/lessons/<slug>/publish` with
`Authorization: Bearer <token>` and `{ "specs": [LessonSpec, ...] }` (1–2
specs). It answers 201 with `{ lesson, versions, created: true }` when at least
one version was written, or 200 (`created: false`) when every language is
already current, which adds nothing. A token can read and change your lessons
but cannot create, list or revoke tokens. Revoke a token on the Settings page.

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
   # Moderators: user ids (the `user.id` column), comma-separated. Optional.
   bunx wrangler secret put ADMIN_USER_IDS
   ```

   No provider key is needed: the platform never runs a model (ADR 0010).

   `ADMIN_USER_IDS` is a secret, not a var, so a deploy does not reset it.
   Change it with the same command; the next isolate reads the new list.

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

### Deploy checklist

1. **This release removes hosted generation (ADR 0010).** Migration `0013`
   drops `byok_key`, `generation_job` and `generation_usage`, and the Wrangler
   `v2` migration deletes the `GenerationAgent` Durable Object and its
   transcripts. Back up anything you still need before `bun run deploy`.
2. Order: `bun run deploy` (build, then remote migrations, then
   `wrangler deploy`). Run `bun run seed:remote` only after the new Worker is
   live, never before. Don't publish or change lesson settings while the
   deploy runs: the old Worker would write stale search rows that nothing
   repairs.
3. Admins: `bunx wrangler secret put ADMIN_USER_IDS` (comma-separated user
   ids) if the list changed. Admin powers need a session cookie; an API token
   never has them.
4. Search rows. During the deploy the old Worker can still serve for a few
   seconds after the migrations ran. The cron (every 30 minutes) and every
   concept publish repair what it wrote. Both counts must reach 0:

   ```bash
   bunx wrangler d1 execute learn --remote --command \
     "select (select count(*) from lesson_lang where fts_rowid is null) as lesson_null,
             (select count(*) from concept_lang where fts_rowid is null) as concept_null"
   ```

   Search backfill progress (lesson languages still without search text; the
   cron fills 50 per run):

   ```bash
   bunx wrangler d1 execute learn --remote --command \
     "select count(*) as todo from lesson_lang where search is null"
   ```

5. Security headers: the Worker and the static assets each set a CSP.

   ```bash
   curl -sI https://learn.sirin.dev/ | grep -i content-security-policy
   curl -sI https://learn.sirin.dev/explore | grep -i content-security-policy
   curl -sI https://learn.sirin.dev/api/health | grep -i content-security-policy
   ```

6. Agent assets: the skill and schema must be public and fresh.

   ```bash
   curl -fsS https://learn.sirin.dev/agent/SKILL.md | head -3
   curl -fsS https://learn.sirin.dev/agent/learn.mjs | head -1
   curl -fsS https://learn.sirin.dev/api/agent/lesson-schema | head -c 80
   ```
