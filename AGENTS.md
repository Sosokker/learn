# Agent instructions

Working rules and code standards for this repo. `CLAUDE.md` only imports this
file; edit this one.

Product and design: `docs/design.md`. Decisions: `docs/adr/`. Local run,
OAuth and Cloudflare setup: `README.md`.

## Working with the project

- Treat every document, this one included, as possibly outdated. Check claims
  against the code and the tests. Where `docs/design.md` and the code differ,
  the code wins; fix the doc.
- Follow the user's latest direction. If code or docs conflict with it, say so
  and say what you would do instead.
- Record a choice that differs from the stack in `docs/design.md` §7 as an ADR
  in `docs/adr/` (copy `0000-template.md`).
- Keep docs small: goals and non-obvious reasons only. Don't copy code into
  docs.
- Preserve unrelated working-tree changes. Ask before committing.

## Commands

| Command | What it does |
|---|---|
| `bun install` | Install dependencies (Bun 1.4, isolated linker) |
| `bun run dev` | Vite + the Worker (`@cloudflare/vite-plugin`) on http://localhost:5187 |
| `bun run db:generate` | drizzle-kit migration from schema changes, then flatten it for wrangler |
| `bun run db:migrate:local` | Apply migrations to the local D1 |
| `bun run seed:local` | Migrate, then publish `content/` (concepts + guide) as `@learn` locally |
| `bun run seed:remote` | Same plan for the deployed D1 + R2 (`--dry-run` prints it; ask the user before a real run) |
| `bun run typecheck` | Type-check every package |
| `bun run lint` / `bun run format` | Biome check / fix |
| `bun run test` | All package tests (Vitest; the Worker's run on Miniflare) |
| `bun run test:e2e` | Playwright |
| `bun run build` | SPA build + Worker dry-run bundle |
| `bun scripts/publish.ts <file\|dir>` | Validate locally, then publish a lesson with `LEARN_TOKEN` (`--dry-run`, `--slug`, `--url`) |
| `bun run deploy` | Build, remote migrations, `wrangler deploy` (ask the user first) |

Run `bun run typecheck` and `bun run lint` after every change, and the tests of
the packages you touched.

## Layout

```
apps/web           React SPA                                   -> api, domain, lesson, ui
apps/worker        Worker entry (worker.ts), HTTP handlers (http.ts), session middleware
                   (session.ts), R2 layer, the AI job Durable Object (generation-agent.ts);
                   wrangler.jsonc; scripts/seed-local.ts; tests
                                                               -> agent, api, auth, db, domain, services
packages/domain    LessonSpec/ConceptSpec schemas, Rich parser, expression parser, validator,
                   codec + JSON Schema export. Pure: no IO.
packages/api       HttpApi definition (api.ts), models, errors, middleware tags   -> domain
packages/db        Drizzle sqlite schema, auth schema, migrations, Database layer  -> domain
packages/auth      Better Auth (Google only, native D1), profile hook, secret rules -> api, db, domain
packages/services  Lessons, Engagement (likes, bookmarks, progress), Concepts, Feeds,
                   Categories, Profiles, ContentAccess, HotScore, Generations, ByokKeys,
                   GenerationSettings; Storage and GenerationRunner seams
                                                               -> api, db, domain
packages/agent     AI lesson agent (ADR 0009): pi loop, fixed tools, static prompt,
                   fake provider                               -> api, domain, services
packages/ui        Linear tokens, fonts, role colors, Base UI wrappers, app i18n
packages/lesson    The lesson renderer (sections, widgets, inspector, KaTeX, @ref prompts)
                                                               -> domain, ui
content/           guide/{en,th}.json and concepts/<slug>/{en,th}.json
e2e/               Playwright
```

Imports go one way only. `apps/web` never imports `db`, `auth` or
`services`. A package may import only what its `package.json` lists.

## Where the contract lives

- **Lesson and concept format:** `packages/domain/src/lesson.ts` (Effect
  Schema). This is the contract between pi, the server and the renderer.
  `codec.ts` decodes strictly and exports JSON Schema. `validate.ts` checks
  references, ranges, expressions and translation parity. Change all three
  together, and update `content/` and the renderer in the same change.
- **HTTP API:** `packages/api/src/api.ts` (routes), `models.ts` (payloads),
  `errors.ts` (errors with their HTTP status). The handlers are in
  `apps/worker/src/http.ts`. The web client is derived from `Api`.
- **Database:** `packages/db/src/schema.ts` and `auth-schema.ts`. Migrations
  in `packages/db/migrations/` (see `packages/db/README.md`).

## Rules

### Access

- A private lesson is **404** for everyone except its owner, including
  signed-in users. Never 403: that would say the lesson exists.
- Any read that can see a private lesson must require `CurrentUser` in its
  Effect type. Follow `LessonReads<R>` in `packages/services/src/lessons.ts`:
  `anonymous: LessonReads<never>` filters out private rows, and
  `asUser: LessonReads<CurrentUser>` adds the owner's own.
- Owner-only changes look the row up with `owner_id = CurrentUser.id` and
  return the same 404 when it doesn't match.
- `CurrentUser` comes only from the `Authenticated`, `SessionAuthenticated` or
  `Viewer` middleware (session cookie, or an API token's hash looked up in D1).
  Never take a user id from a body, query or header.
- API tokens (ADR 0008) act as their user everywhere `Authenticated` or
  `Viewer` is used, but never on `/api/me/tokens` (`SessionAuthenticated`), so
  a token cannot mint or revoke tokens. Store only the sha256.
- `/c/<hash>.json` serves only hashes of non-deleted public or unlisted lesson
  versions, or concept versions (`ContentAccess`). Private bodies go through
  the owner-checked `/body` endpoint with `no-store`. Read ADR 0003 before you
  change either.
- Only `packages/auth` and `packages/db` may import `@app/db/auth-schema`
  (Biome `noRestrictedImports`).

### Database (D1)

- D1 bills rows scanned. Every list query needs an index that covers it.
  Public feeds use partial indexes (public rows only).
- Lists are keyset pages (`after`, `toPage` in
  `packages/services/src/rows.ts`, cursor in `packages/api/src/models.ts`).
  **No `OFFSET`. No `COUNT(*)` for totals.** Counters live on the row and are
  adjusted (±1, only the changed lesson's rows read) in the same batch as the
  change. See `countedAs` in `packages/services/src/lessons.ts`.
- D1 has no interactive transactions. A multi-row change is one
  `Database.batch([...])`.
- Drizzle only compiles SQL (`sqlBuilder`, `raw(sql\`…\`)`); `Database.query`
  runs it and decodes rows with a Schema. Columns are snake_case.
- Migrations: change the schema, run `bun run db:generate`. FTS5 and seed rows
  are hand-written: `bunx drizzle-kit generate --custom --name=<name>` in
  `packages/db`, then `bun scripts/flatten-migrations.ts`. **Never edit a
  migration that exists**; add a new one.

### Content and ids

- Ids (parts, cards, sections, items, params) match `^[a-z][a-z0-9_]{0,31}$`.
  Concept slugs match `^[a-z0-9-]+(\.[a-z0-9-]+){1,4}$`.
- **en/th parity:** every lesson and concept in `content/` has `en.json` and
  `th.json` with identical ids, section types, links and widget shapes. Only
  prose differs. The server enforces the same rule on publish.
- The content test (`packages/domain/test/content.test.ts`) decodes and
  validates every file in `content/`, checks parity, and checks the concept
  graph. Run `bun run --cwd packages/domain test` after editing content.
- App UI strings: `packages/ui/src/messages.ts`. Renderer strings:
  `packages/lesson/src/messages.ts`. English is the source; Thai must have every
  key (a missing key is a type error). Add both in the same change.
- Lesson role colors appear only inside lesson content. The app UI uses the
  lavender accent (`#5e6ad2`) only.
- Renderer conventions the schema doesn't enforce: `incline` param ids
  `theta`, `mu`, `m`, `d`, `g`; `incline.parts` keys are force names
  (`weight`, `normal`, `friction`, `accel`); `trace` lines are 1-based.

### Dependencies

- Pin exact versions (`"effect": "4.0.1"`, never `^` or `~`). Use the same
  version of a library in every package.
- Bun uses the **isolated linker** (`node_modules/.bun`). A package sees only
  the dependencies it lists. Every import needs an entry in that package's own
  `package.json`, including CSS imports and type packages. Example:
  `packages/ui/src/styles.css` does `@import "tailwindcss"`, so `packages/ui`
  lists `tailwindcss` even though only `apps/web` runs Tailwind.
- Workers runtime types come from `@cloudflare/workers-types`, listed in each
  package that uses `D1Database` or `R2Bucket`.

### AI generation

- The prompt prefix (tools in `packages/agent/src/tools.ts`, `systemPrompt` in
  `prompt.ts`) must be the same bytes for every job: no dates, users or ids.
  A change is a cache miss for every user until it warms again.
- Tools never take a user or lesson id. The job's user comes from its row.
- Provider keys (platform or BYOK) are passed to pi explicitly. Tests use the
  fake provider: never a real key or a network call to a provider.

## Code standards

### Effect v4

Models often write Effect v3. If unsure, read the `effect-v4` skill in the
template (`~/work/parich/projects/projects-template/.claude/skills/effect-v4/SKILL.md`).

- All IO, retries and dependency injection are `Effect`. Plain helpers stay
  synchronous and pure. A parser or validator does not return an `Effect`
  (`packages/domain` returns `Result` or a list of issues).
- Services: `class X extends Context.Service<X, Shape>()("@app/pkg/X")` with a
  `static readonly layer`. Not `Context.Tag`, `Effect.Service` or
  `ServiceMap.Service`. No static accessors: `yield*` the service, then call
  it, or `X.use(f)`.
- Wrap service methods in `Effect.fn("Service.method")`, so each call is a span.
- Read settings with `Config`. No `process.env` in app code. A new Worker
  variable goes in the `Env` interface and the `ConfigProvider` map in
  `apps/worker/src/worker.ts`, in `.dev.vars.example`, and in
  `wrangler.jsonc` (var) or the README's secret list.
- Errors are `Schema.TaggedError` classes. HTTP errors and their status codes
  live in `packages/api/src/errors.ts`, so the client gets typed errors.
  Unexpected failures (D1, R2, decoding stored data) become defects with
  `Effect.orDie`.
- Import paths: `effect`, `effect/http`, `effect/http-api`, `effect/sql`.
- No `try` / `catch` in Effect code. Use `Effect.try`, `Effect.tryPromise`,
  `Effect.catchTag`.

### Types and Biome

- No `any`. No `as` casts on outside data. Decode with Schema: request bodies,
  stored JSON, env, rows.
- Branded ids (`LessonId`, `LessonVersionId`, `PartId`), not bare strings.
- No `export *` (`noReExportAll`). Name every export.
- No namespace imports (`import * as X`) unless a library's documented API
  needs one (`noNamespaceImport`).
- No non-null assertions (`!`), no unused imports or variables, `import type`
  for types, no `else` after `return`.
- One `index.ts` per package (its entry point), no other barrels.
- `const` over `let`. Early returns. Comments explain why, never what.

## Testing

- `packages/domain`: parsers, validator, content test (Vitest, Node).
- `packages/lesson`: renderer tests (Vitest).
- `apps/worker`: integration tests run the Worker's own layers against
  Miniflare's in-memory D1 and R2, migrated with the same SQL files wrangler
  applies (`test/support.ts`). They cover access control (owner, other user,
  anonymous, unlisted), publish rules, concept pinning, auth, and Thai
  segmentation in workerd.
- No mocks. Provide a stub Layer when a boundary needs isolating. No network
  and no real keys in tests.
- New access rules need a test in `apps/worker/test/access.test.ts`.

## Not built yet

pi's `/publish` extension (API tokens and `scripts/publish.ts` exist); fork; the
`problem_hash` reuse check; hot feeds by language or category; anonymous feed
caching; e2e audit port; for AI jobs: cheaper sub-task models, Batch APIs, a
daily cost cap, a real-provider smoke test.
See `docs/design.md` §6.8.
