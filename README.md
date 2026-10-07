# Learn

Interactive lessons you can explore, and a community to share them.
Live at https://learn.sirin.dev (Cloudflare Workers + D1 + R2).

A lesson is typed JSON (a `LessonSpec`), not a page: colored **parts** you can hover anywhere, **cards**
you can drill into, **steps** with why and why not, line-by-line **proofs**, live **widgets**, and an
`@ref` address for every piece. Lessons are written by pi (a local AI tutor) and published here; the
"Start here" guide (`content/guide/`) shows every tool.

- Design: [docs/design.md](docs/design.md) · decisions: [docs/adr/](docs/adr/) · UI style:
  [docs/linear-DESIGN.md](docs/linear-DESIGN.md) · notes for agents: [AGENTS.md](AGENTS.md)

## Run it locally

Needs [Bun](https://bun.sh) ≥ 1.4.

```sh
bun install
cp apps/worker/.dev.vars.example apps/worker/.dev.vars   # then fill in Google OAuth (below)
bun run db:migrate:local    # creates the local D1 in apps/worker/.wrangler/state
bun run seed:local          # the guide + shared concepts, public, owned by @learn
bun run dev                 # http://localhost:5173: the SPA and the Worker in one Vite server
```

Everything works without Google credentials except signing in.

Checks:

```sh
bun run typecheck
bun run lint                # biome; `bun run format` fixes
bun run test                # unit tests + Worker integration tests (local D1/R2 via wrangler)
bun run test:e2e            # Playwright against the dev server (migrates, seeds, signs in a test user)
```

If the installed Chromium doesn't match Playwright's build, point it at one:
`PW_CHROMIUM=/opt/pw-browsers/chromium bun run test:e2e`.

`bun run --cwd packages/lesson playground` opens the lesson renderer on the guide, without the API.

### Google sign-in

In the [Google Cloud console](https://console.cloud.google.com/apis/credentials), create an
**OAuth client ID** of type *Web application* with these redirect URIs:

| Where | Authorized redirect URI | Authorized JavaScript origin |
|---|---|---|
| local | `http://localhost:5173/api/auth/callback/google` | `http://localhost:5173` |
| production | `https://learn.sirin.dev/api/auth/callback/google` | `https://learn.sirin.dev` |

Put the client id and secret in `apps/worker/.dev.vars` for local dev.

## Deploy

### One-time Cloudflare setup

```sh
cd apps/worker
bunx wrangler login
bunx wrangler d1 create learn                 # copy the database_id into wrangler.jsonc
bunx wrangler r2 bucket create learn-content
bunx wrangler secret put BETTER_AUTH_SECRET   # openssl rand -base64 32
bunx wrangler secret put GOOGLE_CLIENT_ID
bunx wrangler secret put GOOGLE_CLIENT_SECRET
```

The custom domain `learn.sirin.dev` is declared in `wrangler.jsonc` (`routes`), and the `sirin.dev`
zone must be on the same Cloudflare account. The rate-limit binding (`WRITE_LIMIT`) and the cron
need no setup.

### Every deploy

```sh
bun run deploy   # build → apply D1 migrations (remote) → wrangler deploy
```

Then seed the platform content once on production with pi's `/publish` or the API (the guide and
concepts in `content/`), owned by a `learn` account.

## Repository

```
apps/web            React SPA (TanStack Router + Query, Tailwind v4, Base UI)
apps/worker         Cloudflare Worker: HttpApi, Better Auth, /c/<hash>.json, cron, wrangler.jsonc
packages/domain     LessonSpec + ConceptSpec (the pi contract), Rich and expression parsers, validator
packages/api        HttpApi definitions shared by worker and web
packages/db         Drizzle schema + migrations for D1
packages/auth       Better Auth (Google only)
packages/services   lessons, concepts, profiles, API tokens, hot score
packages/ui         Linear tokens, components, i18n (EN/TH)
packages/lesson     the lesson renderer and widget catalog
content/            the guide and shared concepts (validated by tests)
e2e/                Playwright smoke tests and the widget overlap audit
```
