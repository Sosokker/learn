# Handoff — 2026-10-07

> **Status update (2026-10-29):** hosted AI generation and BYOK were removed.
> Lesson creation is now bring-your-own-harness (ADR 0010): the user's Claude
> Code, OpenCode, Codex or pi writes the lesson, and `learn` validates and
> publishes it. The rest of this file is the 2026-10-07 handoff, kept as history;
> `README.md`, `AGENTS.md`, `docs/design.md` and `docs/adr/` are current.

> **Status update (2026-10-07, later):** the scaffold below is built, reviewed and deployed to
> https://learn.sirin.dev (D1 + R2 created, migrations applied, guide seeded with `bun run seed:remote`).
> The current docs are README.md, AGENTS.md, docs/design.md and docs/adr/. Still not built: pi `/publish`
> API tokens, likes/bookmarks/comments/progress, lesson search, hot feed endpoint, and the cost items from
> the review (category feed temp b-tree, hot cron scan, tag count(*), FTS delete scan, CSP headers).

## Goal

Build **Learn** (https://learn.sirin.dev): interactive lessons (parts you can hover, cards
you can drill into, chains of steps with why and why not, proofs, live widgets, `@ref`s)
plus a community where users share lessons by category and tag. Cloudflare only
(Workers + D1 + R2), deployed with wrangler. Linear-style UI. English and Thai from the
start. Private GitHub repo: https://github.com/Sosokker/learn.

## Read first

- `docs/design.md`: the full design (cost, D1 model, LessonSpec, stack changes from
  the template, Linear UI, build order). **Sections 4–7 are out of date.** They don't
  include A–C below yet.
- `docs/linear-DESIGN.md`: UI tokens (from voltagent/awesome-design-md).
- `packages/domain/src/lesson.ts`: the LessonSpec + ConceptSpec Effect Schema. This is the
  contract between pi, the server and the renderer.
- Template to derive from: `~/work/parich/projects/projects-template` (its AGENTS.md,
  docs/stack.md, `.claude/skills/effect-v4/SKILL.md`).
- Prototype to port: `~/learn/prototype/learn.html` (+ `audit.js`, an overlap checker).
- Where it came from: the Claude session "Current pi setup usage" (pi learning
  setup → prototype).

## Decisions made by the user

- No Postgres → **D1** for metadata, R2 for immutable lesson bodies (`c/<sha256>.json`).
- **wrangler** + `@cloudflare/vite-plugin`, not Alchemy. Domain `learn.sirin.dev` (the
  sirin.dev zone is already on Cloudflare).
- Sign-in: **Google only** for now.
- **Multi-user**: lessons are `private` (default) | `unlisted` | `public`. A non-owner gets
  **404** on a private lesson. Every private-lesson query goes through a service whose type
  requires `CurrentUser`.
- **Shared concepts**: a concept is written once (e.g. `physics.newton-second-law`) and
  lessons point a local card id at it: `"cards": { "newton2": { "concept": "physics.newton-second-law" } }`.
  The concept version is pinned at publish (`lesson_version_concept`). The lesson-writing
  agent searches `GET /api/concepts?q=` to reuse concepts instead of writing new cards
  (saves tokens). Concept bodies are cached at the edge like lesson bodies.
- **Right tool per job**: React Flow (`@xyflow/react`) + dagre for the `flow` widget and the
  concept graph. KaTeX for math. Plain SVG + a safe expression parser (no eval) for `plot`.
- **LLM and lesson creation on the website are deferred** (the next step after this
  scaffold). In v1, lessons come from local pi via `/publish`.
- Lesson role colors appear only inside lesson content. The app UI is lavender (`#5e6ad2`) only.

## Done

- Repo created and pushed (commit 1: design doc + Linear reference).
- `packages/domain/src/lesson.ts`: LessonSpec (sections, widgets, parts, cards,
  CardEntry = Card | {concept}) and ConceptSpec.
- `content/guide/en.json` + `content/guide/th.json`: the "Start here" guide lesson (kind
  `guide`). It uses a train problem (hidden trap: the 30-min stop) to show every tool.
  Both languages have identical part, card and section ids.
- `content/concepts/{physics.total-time, physics.average-speed, physics.mean-speed-theorem}/{en,th}.json`.
- Builder agent wrote the root `package.json`, `biome.json`, `tsconfig.base.json`, and the
  per-package `package.json`/tsconfig for `apps/{web,worker}`, `packages/{domain,api,db,auth,services,ui,lesson}`
  and `e2e`. Versions are pinned to match the local bun cache (wrangler 4.147.0,
  `@cloudflare/vite-plugin` 1.62.5, miniflare 5.20261001.0-alpha, `@effect/sql-d1` 4.0.1).
  **Not reviewed yet.**
- Fixed: part id `T` → `tt` in both guide files (ids must match `^[a-z][a-z0-9_]{0,31}$`).
- Nothing since commit 1 is committed (the user asks before each commit).

## Blocker

**The disk is full**: about 125 MB free on a 460 GB disk. `bun install` failed partway, so nothing is
installed, built or tested. Suggested fix: `npm cache clean --force` (frees ~1.8 GB of
`~/.npm`). It is outside the repo, so ask the user first. Do **not** clear `~/.bun/install/cache`
(3.8 GB): it holds almost every pinned version, so the install can run mostly offline.
About 2 GB free is needed for the install, Vite/wrangler state, builds and screenshots.

## Next steps

1. Free disk space (user), then `bun install`.
2. Continue the builder's checklist (`TASKS.md`, gitignored):
   - [ ] domain: Rich markup parser, expression parser, one shared validator for references
         and translation parity, plus a content test over `content/**` (guide + concepts:
         every `[part:]`, `{card|}`, `\p{}{}`, `uses`, `deps`, `needs`, widget `part`,
         `{concept}` resolves; en/th id sets equal; concept `needs` resolve with no cycles)
   - [ ] db: drizzle sqlite schema + flat wrangler-compatible migrations. Use the design.md §5
         model, plus: `lesson_version.lang` with `unique(lesson_id, lang, n)`; `lesson_lang`
         instead of `current_version_id`; concept tables (`concept`, `concept_version`,
         `concept_lang`, `concept_need`, `lesson_version_concept`, `concept_fts`); a
         category seed incl. `platform.guide`
   - [ ] auth: Better Auth Google-only on D1 (drizzle sqlite adapter), cookieCache, profile row on first sign-in
   - [ ] services + api: health, me, categories; lessons CRUD + visibility + versions per
         lang; public feeds (keyset); `/c/:hash.json` only for public/unlisted hashes;
         private body via an owner-checked API; concepts search/get/create; concept bundle per lesson version
   - [ ] worker: `wrangler.jsonc` (DB, CONTENT, custom domain, cron, `run_worker_first` `/api/*`,`/c/*`), `.dev.vars.example`
   - [ ] ui: Linear tokens, Inter + IBM Plex Sans Thai + JetBrains Mono via @fontsource, i18n EN/TH
   - [ ] lesson renderer: port the prototype (highlight, inspector + drill-down tree,
         chain/proof/recall, try mode, @ref chips + "copy prompt for pi"), React Flow +
         dagre (lazy-loaded), plot/table/incline/trace widgets, shared-concept badge
   - [ ] web: shell (sidebar, language switch, Google sign-in), `/` with the guide pinned,
         `/guide`, `/explore`, `/library` (upload JSON, set visibility/category/tags), `/@:handle/:slug`
   - [ ] `seed:local`: guide + concepts as a public lesson owned by `@learn`
   - [ ] tests: access control (owner / other / anonymous / unlisted), publish rules,
         content test; Playwright smoke + port of `audit.js`
   - [ ] docs: update design.md §4–7; ADRs (D1, wrangler, R2 immutable bodies, no user HTML/JS,
         shared concepts, React Flow); README (local run, Google OAuth redirect URIs,
         one-time Cloudflare setup); AGENTS.md + CLAUDE.md (`@AGENTS.md`)
   - [ ] verify: typecheck, lint, test, build; check `/` and `/guide` in a browser at desktop
         and 375px, EN and TH; screenshots in `docs/screenshots/`
3. Ask the user to commit. Then the user does the one-time Cloudflare setup (`wrangler d1 create learn`,
   `wrangler r2 bucket create learn-content`, put the database_id in wrangler.jsonc, set Google OAuth
   creds as secrets) → deploy only with the user's OK.
4. After that: LLM lesson creation (BYOK in the browser, lazy drill-down cards, a reuse check
   before generating).

## Open questions (from design.md §10)

- Does the drizzle-kit migration layout work with `wrangler d1 migrations apply`? (Plan: flatten it.)
- Better Auth on D1: drizzle sqlite adapter or the native binding?
- Does `Intl.Segmenter('th')` work in workerd (Thai FTS)?
- FTS in a second D1 database, so exports work?
