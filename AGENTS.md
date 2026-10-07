# Learn: notes for agents

Interactive lessons (parts, cards with drill-down, steps with why / why not, proofs, live widgets,
`@ref`s) plus a community to share them. Cloudflare only: one Worker, D1, R2. Read
`docs/design.md` first, then `docs/adr/`. UI style: `docs/linear-DESIGN.md`.

## Layout
- `packages/domain`: the contract. `lesson.ts` (LessonSpec, ConceptSpec), `models.ts` (API models
  and errors), `rich.ts` (Rich markup parser), `expr.ts` (safe expression parser), `validate.ts`
  (references, translations, concepts). Pure TypeScript and Effect Schema, no platform APIs.
- `packages/api`: HttpApi groups shared by the worker and the web client.
- `packages/db`: Drizzle schema, migrations, the `Db` service. `auth-schema.ts` holds session and
  OAuth tokens, and only `packages/auth` may import it (biome enforces this).
- `packages/services`: business rules. A function that touches private data requires
  `CurrentUser` in its Effect type. Visibility rules live here, nowhere else.
- `apps/worker`: HttpApi handlers, session middleware, `/c/<hash>.json`, edge cache, cron.
- `packages/lesson`: the renderer. `packages/ui`: Linear tokens, components, i18n. `apps/web`: the SPA.
- `content/`: the guide and shared concepts. `content.test.ts` validates every file.

## Commands
```sh
bun install
bun run db:migrate:local && bun run seed:local   # local D1 + R2 with the guide
bun run dev                                       # http://localhost:5173 (Vite + Worker)
bun run typecheck && bun run lint && bun run test
bun run test:e2e                                  # Playwright (starts the dev server)
bun run db:generate                               # after changing packages/db/src/schema.ts
```

## Rules
- Effect v4 (4.0.1). Its docs ship in `node_modules/.bun/effect@4.0.1/node_modules/effect/AGENTS.md`
  and `ai-docs/`. Use those, not memory: v4 renamed many v3 APIs.
- No user HTML or JS in lessons (ADR 0004). Rich text is parsed with a fixed grammar; widget
  expressions go through `compileExpr`, never `eval`.
- A lesson and its translation share every id. Run the validator (`validateLesson`,
  `translationIssues`) on any lesson you write; `content/**` is checked by tests.
- D1 bills rows scanned: every list query needs an index that covers it, paging is keyset, and
  counters live on rows. D1 has no interactive transactions: put writes that belong together in
  one `db.batch([...])`.
- A private lesson is a 404 for everyone but its owner. Never send a private body's hash to
  another user; `/c/` serves only public and unlisted hashes.
- Lesson role colors appear only inside lesson content. The app UI uses one accent (lavender).
- Every user-facing string exists in English and Thai.
- Style: Biome (2 spaces, no semicolons, double quotes, width 110). No `export *`, no non-null
  assertions, no namespace imports. Comments explain why, not what.
- Migrations in `packages/db/migrations` are append-only: once applied anywhere, never edit one.
