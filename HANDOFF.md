# Handoff (2026-10-07, after the scaffold)

Branch `feature/admiring-lamport-396yoz`. Read `AGENTS.md`, `docs/design.md`, `docs/adr/`.

## Done
- Every item on the scaffold checklist: domain (Rich and expression parsers, validator, content
  test), db (schema, flattened migrations, FTS, category seed), auth (Google only), services + API,
  worker (`wrangler.jsonc`, `/c/` rules, edge cache, rate limit, cron), ui (Linear tokens,
  components, EN/TH i18n), lesson renderer (+ playground), web (home, guide, explore, library,
  reader, settings), `seed:local`, tests, docs (design §4–7 and §10, ADRs, README, AGENTS.md).
- Checks: `bun run typecheck`, `lint`, `test` (domain 21, lesson 24, worker 18), `build`, and
  `test:e2e` (22 tests, desktop + 375px, including real cookie sign-in and the plot overlap
  audit) all pass. Screenshots are in `docs/screenshots/`.

## Not done / next
1. One-time Cloudflare setup and first deploy (README → Deploy). Deploy only with the owner's OK.
   Then seed production content (guide + concepts) as the `learn` account.
2. Real Google sign-in has only been exercised with a forged session cookie in e2e; try it once
   with real credentials locally.
3. Not built yet: likes, bookmarks, forks, comments on `@refs`, profile pages, reports.
4. Phase 2: LLM lesson creation in the browser (BYOK), lazy drill-down cards, reuse check.

## Known rough edges
- Vite reserves `/@…` paths in dev; `apps/web/src/main.tsx` rewrites `/%40…` back to `/@…`.
- Feed rows show the first language's title only.
- Incline widget expects a param named `angle` (schema doesn't say so yet).
- Who may edit a shared concept beyond its author is open (design §10).
