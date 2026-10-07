# Learn — design

Status: draft, 2026-10-07. Sections 4–7 and 10 updated after the scaffold was built.
Live at: https://learn.sirin.dev (Cloudflare, deployed with wrangler).

Inputs:
- The pi learning session ("Current pi setup usage") and its prototype
  `~/learn/prototype/learn.html`: 5 lesson types (Solve, Learn, Business, Code,
  Proof), linked colored parts, cards with drill-down, proofs line by line,
  concept graphs, sliders, recall quizzes, `@ref` chips for asking pi.
- Stack template: `~/work/parich/projects/projects-template` (Bun monorepo,
  Effect v4, HttpApi, Drizzle, React + Vite + TanStack, Base UI + Tailwind v4,
  Better Auth, Biome, Vitest, Playwright).
- UI style: Linear (`docs/linear-DESIGN.md`, from
  voltagent/awesome-design-md).

Prices and limits below were checked on 2026-10-07 from Cloudflare docs and
the OpenRouter models API.

---

## 1. Summary

| Decision | Choice | Why |
|---|---|---|
| Database | **D1** (SQLite) for metadata, counters, search index | No Postgres. Billed per row, so a good index is also a cost control. |
| Lesson content | **R2**, one immutable JSON file per published version, named by its hash | Lessons are big (30–150 KB). R2 storage is cheap and egress is free. D1 stays small. |
| Hosting | One **Worker** serves `/api/*` and the SPA assets | Same as the template |
| Deploy | **wrangler** + `@cloudflare/vite-plugin` (no Alchemy) | Your choice. One `wrangler.jsonc`, one dev command. |
| Domain | `learn.sirin.dev` as a Worker custom domain | sirin.dev is already on Cloudflare DNS. A custom domain also turns on the edge Cache API. |
| Auth | Better Auth, **Google sign-in only** (GitHub later), no passwords | No email service to pay for, and no password hashing on Worker CPU |
| Lesson format | A typed **LessonSpec** JSON (Effect Schema). No user HTML or JS. | Safe to share in public. Every lesson gets the same hover, link and card behavior. pi can't break it. |
| Visuals | A fixed **widget catalog** with parameters | A shared lesson can't run code |
| Who pays for the LLM | **The learner, not the platform** (phase 1: local pi, phase 2: bring your own key) | The LLM is the only cost that grows quickly. Infra stays near $5/month. |
| UI | Linear: dark, dense, hairline borders, one lavender accent | Lesson role colors appear only inside lesson content, never in the app UI |

Expected cost: **$5/month** (Workers Paid) up to about 20k monthly users. The
free plan would likely work too, but its 10 ms CPU limit is a risk with Effect
and auth on cold start.

---

## 2. Where cost comes from, and how we keep it low

### 2.1 Cloudflare prices (checked 2026-10-07)

| Service | Free | Workers Paid ($5/mo) |
|---|---|---|
| Workers | 100k req/day, 10 ms CPU | 10M req/mo, then $0.30/M. 30M CPU-ms, then $0.02/M. |
| D1 | 5M rows read/day, 100k written/day, 5 GB, 500 MB per DB | 25B read/mo, 50M written/mo, 5 GB included. 10 GB per DB. |
| R2 | 10 GB, 1M Class A, 10M Class B per month | $0.015/GB-mo, A $4.50/M, B $0.36/M, egress free |
| KV | 100k reads, 1k writes/day | 10M reads, 1M writes/mo |
| AI Gateway | analytics, caching, rate limits free | same |

### 2.2 Estimate

Assume 20k monthly users, 2M page views a month, about 5 API calls per view,
20k lessons of about 60 KB gzipped.

| Item | Use | Cost |
|---|---|---|
| Worker requests | ~10M/mo (cache hits are not Worker calls) | inside $5 |
| D1 reads | ~50 rows per request × 10M = 0.5B | inside 25B |
| D1 writes | likes, progress, publishing: ~5M | inside 50M |
| D1 size | ~200 MB (bodies are in R2) | inside 5 GB |
| R2 | 1.2 GB, a few million reads | free tier |
| **Total infra** | | **≈ $5/mo** |

LLM cost for one full lesson (about 4k input tokens, 12–15k output tokens):

| Model (OpenRouter, $/M in / out) | Per lesson |
|---|---|
| gemini-2.5-flash-lite (0.10 / 0.40) | ~$0.006 |
| deepseek-v4-pro (0.21 / 0.42) | ~$0.007 |
| deepseek-v4.1-flash (0.05 / 1.20) | ~$0.02 |
| a frontier model (~3 / 15) | ~$0.25 |

At 1,000 lessons a day on a frontier model, that is ~$7,500 a month. So the
real cost question is **who runs the LLM**, not the hosting.

### 2.3 Cost rules

1. **The platform does not pay for generation in v1.** Lessons are made by
   your local pi (your own subscription or key) and published with
   `/publish`. Phase 2 adds web generation with the learner's own OpenRouter
   key. The browser calls OpenRouter directly, so no Worker CPU is used and the
   key never reaches our server. Hosted generation with a free quota waits until
   there is a reason to pay for it.
2. **Reuse before you generate.** When a learner pastes a problem, search the
   community first (exact match on the normalized problem text, then
   full-text search). "Fork this lesson" costs nothing. Generating again costs
   money.
3. **Generate lazily.** First the skeleton (chunks, plan, chain). Drill-down
   cards are made when someone clicks them, then saved into the lesson so the
   next reader gets them free.
4. **Immutable content gets cached at the edge.** A published version lives at
   `/c/<sha256>.json` with `Cache-Control: public, max-age=31536000, immutable`.
   After the first read in a region, Cloudflare's cache serves it. No Worker
   CPU, no R2 operation.
5. **Anonymous feeds are cached for 60 s** with the Cache API (this needs the
   custom domain). Per-user data, such as "did I like these 20 lessons?", is
   one small batched call.
6. **Every list query uses an index that covers it.** D1 bills rows *scanned*,
   so a missing index is a cost bug, not only a speed bug. Use keyset paging
   (as the template does), never `OFFSET` or `COUNT(*)`. Store counters
   on the row.
7. **Don't write on every view.** No view counter rows. Save progress with a
   10 s debounce plus one `sendBeacon` when the page closes.
8. **Few moving parts.** No KV, Durable Objects, Queues or Vectorize in v1. Add
   each one only when a feature needs it (section 9).
9. **The session lives in a cookie.** Better Auth `cookieCache` (5 min) means a
   signed-in request does not read the session table.

---

## 3. Architecture

```
  local pi (tutor)                         browser (learn.sirin.dev)
  ─ learn skill writes lesson.json          ─ React SPA: reader, library, explore
  ─ /publish extension ──── API token ──┐   ─ KaTeX + widget renderer (client side)
                                        ▼   ─ phase 2: BYOK generation → OpenRouter
                         ┌──────── Worker "learn" ────────┐
                         │ HttpApi /api/*   static assets │
                         │ Better Auth      Cache API     │
                         │ cron: hot score, cleanup       │
                         └──┬──────────────┬──────────────┘
                            ▼              ▼
                     D1 "learn"        R2 "learn-content"
                     users, lessons,   c/<sha256>.json (lesson versions)
                     tags, likes,      drafts/<user>/<lesson>.json
                     comments, FTS
```

- The Worker never renders lessons. The browser fetches the JSON and renders
  it, so CPU cost stays on the client.
- pi and the web app share one contract: the LessonSpec JSON Schema, made from
  the Effect Schema in `packages/domain` (`JSONSchema.make`). pi's skill
  validates against it before it publishes.

---

## 4. Lesson content model (LessonSpec)

The source of truth is the Effect Schema in `packages/domain/src/lesson.ts`. It is
the contract between pi, the server and the renderer. This section summarizes it.

```ts
LessonSpec {
  schema: 1                          // the renderer upgrades old versions on read
  kind: "solve" | "learn" | "situation" | "code" | "proof" | "guide"
  lang: "en" | "th"
  title: string                      // ≤ 160
  summary: string                    // ≤ 280 chars, shown in feeds
  parts:  Record<PartId, Part>       // colored things, linked everywhere
  cards:  Record<CardId, CardEntry>  // a card, or a pointer to a shared concept
  sections: Section[]                // ordered page content, each with an `id`
}

Part      { label: Rich, role: Role, color: RoleColor, meaning: string,
            body?: Rich, example?: Rich, analogy?: Rich }
Role      = given | hidden_given | goal | derived | constant | condition
          | actor | metric | variable | concept
RoleColor = red | orange | peach | yellow | mustard | olive | green | teal | cyan
          | blue | purple | pink | rose | grey          // tokens, not hex
CardEntry = Card | { concept: "physics.average-speed" | "physics.average-speed@2" }
Card      { kind: term | law | formula | def | lemma | thm | metric | story | feature,
            title: Rich, kicker?: string, body: Rich,
            says?, from?, useWhen?, units?, example?, analogy?: Rich }

Section = { id, title?, note? } & (
  | { type: "text" | "problem", body: Rich }
  | { type: "chunks",  rows: { id, text: Rich, role: Role, note: Rich }[] }
  | { type: "concept", concept: Rich, field: Rich, prerequisites: CardId[] }
  | { type: "plan",    routes: { id, title, path, why, whyNot: Rich, picked: boolean }[], notUsed?: Rich }
  | { type: "chain",   steps: Step[] }
  | { type: "proof",   goal: Rich, lines: ProofLine[] }
  | { type: "graph",   nodes: { id, label, kind, needs: Id[], card?: CardId, part?: PartId }[] }
  | { type: "visual",  widget: Widget }
  | { type: "check",   items: Rich[] }
  | { type: "story",   events: { id, year?, text: Rich }[] }
  | { type: "units",   units: { id, title, milestone: Rich, lessonSlug? }[] }   // study plan
  | { type: "recall",  questions: { id, q: Rich, options: Rich[], answer: number, why: Rich }[] })

Step      { id, move: Rich, formula?: Tex, why: Rich, whyNot?: Rich, uses: PartId[] }
ProofLine { id, claim: Rich, why: Rich, intuition?: Rich, whyNot?: Rich, deps: LineId[] }
```

Ids match `^[a-z][a-z0-9_]{0,31}$`. A lesson and its translation share every id.

**Rich text** is a small markup: `[part:label]` links a part, `{card|label}`
links a card, `$tex$` and `$$tex$$` are math (`\$` is a dollar), and `**bold**`,
`*italic*` and `` `code` `` work. Inside TeX, `\p{part}{…}` marks a hoverable
symbol. There is no raw HTML. `packages/domain/src/rich.ts` parses it with a
fixed grammar into a tree, and anything that doesn't match a rule is plain
text. KaTeX runs with `trust` limited to `\htmlData`, which is what `\p{}{}`
becomes.

**One validator** (`packages/domain/src/validate.ts`) checks what the schema
can't: every `[part:]`, `{card|}`, `\p{}{}`, step `uses`, proof `deps` (earlier
lines only), graph `needs` (no cycles), widget `part`, expression variable and
shared concept resolves; ids are unique; a translation has the same id
skeleton as the original. The server runs it on publish, pi can run it before
`/publish`, and a test runs it over `content/**`.

**Drill-down and hierarchy come for free.** The child cards of a card are the
`{card}` links inside it, and for a shared concept, its `needs`. That is how
the "where this sits" tree works, so pi only writes links.

**Shared concepts.** A concept such as Newton's second law is written once
(`ConceptSpec`: slug, lang, one card, `needs`, `aliases`) and reused. A lesson
keeps its own card id, so `{newton2|…}` links work, and points it at the
concept: `"newton2": { "concept": "physics.newton-second-law" }`. At publish,
the server pins the concept's current version in the lesson's language, plus
its prerequisites (transitively), in `lesson_version_concept`, so an edit to
the concept never changes an old lesson. The lesson-writing agent searches
`GET /api/concepts?q=` first and reuses a concept instead of writing a card.
That saves tokens, and readers get one consistent explanation.

**Widgets** are a closed catalog. Expressions use a small safe parser
(`packages/domain/src/expr.ts`: numbers, `+ - * / ^`, a fixed list of
functions, `pi`, `e`, params). It builds closures and never calls `eval`.

| Widget | Covers |
|---|---|
| `plot` | functions of `x` with sliders, points and live readouts |
| `table` | Rich cells: group tables, truth tables, comparisons |
| `flow` | business or data flows (React Flow + dagre) |
| `incline` | physics scene: angle param, force arrows bound to parts |
| `trace` | code + step slider + variable state |

More (`freebody`, `timeline`, `lattice`, `scene`) come as lessons need them.
Each new widget is a schema change plus a renderer component.

**Stable reference IDs.** A reference is `@<lessonSlug>/<sectionId>.<itemId>`,
for example `@guide/chain.s2`. The `@ref` chips and anchored comments both use
this, and the ids are the same in every language.

**Size limit:** 512 KB per spec (32 KB per concept), uncompressed. The server
checks it on publish.

---

## 5. Database model (D1)

The source of truth is `packages/db/src/schema.ts` (Drizzle sqlite-core). IDs are
UUIDv7 text (sortable by time). Times are integer milliseconds. Status fields
are checked text.

```sql
-- Better Auth: user, session, account, verification (packages/db/src/auth-schema.ts;
-- only packages/auth may import it, enforced by biome)

profile (user_id pk → user, handle unique, bio, lesson_count)
category (id pk, parent_id, slug unique, name_en, name_th, sort)      -- seeded in a migration;
                                                                      -- ids are dotted paths, e.g. math.analysis
lesson (
  id, owner_id → user, slug,                   -- unique (owner_id, slug)
  kind check (... 'guide'),
  lang,                                        -- the first language; title/summary copied from it
  title, summary, category_id → category,
  visibility check ('private','unlisted','public') default 'private',
  forked_from_version_id, problem_hash,
  like_count, fork_count, comment_count, hot_score,
  published_at, created_at, updated_at, deleted_at
)
lesson_version (                               -- immutable, one row per version of one language
  id, lesson_id → lesson, lang, n,             -- unique (lesson_id, lang, n)
  body_hash,                                   -- R2 key c/<hash>.json; indexed for /c/ checks
  body_bytes, schema, title, summary, note, created_at
)
lesson_lang (lesson_id, lang, version_id)      -- pk (lesson_id, lang): the current version per language
tag, lesson_tag, lesson_like, bookmark, comment, progress, api_token, report   -- as before

concept (id, slug unique, kind, created_by → user, use_count, created_at, updated_at)
concept_version (id, concept_id, lang, n, body_hash, body_bytes, created_at)   -- unique (concept_id, lang, n)
concept_lang (concept_id, lang, version_id, title, aliases)                    -- current per language
concept_need (concept_id, need_id)                                             -- the prerequisite graph
lesson_version_concept (lesson_version_id, concept_version_id, card_id)        -- pins; card_id null = prerequisite

-- Search: plain FTS5 tables (not contentless), so a match returns the row's id.
create virtual table lesson_fts  using fts5(lesson_id UNINDEXED, title, summary, tags, problem, tokenize='unicode61 remove_diacritics 2');
create virtual table concept_fts using fts5(concept_id UNINDEXED, lang UNINDEXED, slug, title, aliases, body, ...);
```

**Indexes, one for each feed.** SQLite supports partial indexes, so each feed
index holds only public rows:

```sql
create index lesson_new_idx  on lesson (published_at desc, id desc) where visibility = 'public' and deleted_at is null;
create index lesson_hot_idx  on lesson (hot_score desc, id desc)    where visibility = 'public' and deleted_at is null;
create index lesson_cat_idx  on lesson (category_id, published_at desc, id desc) where ...;
create index lesson_kind_idx on lesson (kind, published_at desc, id desc)        where ...;
create index lesson_owner_idx on lesson (owner_id, updated_at desc, id desc);
create index lesson_tag_feed_idx on lesson_tag (tag_id, published_at desc, lesson_id) where is_public = 1;
create index lesson_tag_hot_idx  on lesson_tag (tag_id, hot_score desc, lesson_id)    where is_public = 1;
create index lesson_version_hash_idx on lesson_version (body_hash);
create index concept_version_hash_idx on concept_version (body_hash);
```

A feed page of 20 reads about 21 index rows plus 20 lesson rows, then owners,
languages and tags in one batched round trip.

**Categories vs tags vs kind**

| Field | What it is | Who sets it | Count |
|---|---|---|---|
| category | where the lesson lives, a curated tree | the author picks one, required for public | 1 |
| tags | free labels, such as `galois`, `epsilon-delta`, `friction` | the author; normalized (`Epsilon Delta` → `epsilon-delta`) | 1–5 for public |
| kind | the shape of the lesson (solve, learn, …, guide) | pi | 1 |
| lang | en / th, one or both | pi | 1–2 |

Explore filters combine them: categories (the client sends a category and its
descendants) × kind × lang × one tag × a search query.

**Counters and atomic writes.** D1 has no interactive transactions, so every
write that must happen together is one `db.batch([...])`, which D1 runs as a
single transaction: a new version, its `lesson_lang` pointer, its concept pins,
the FTS row and the recounted `concept.use_count` go in one batch.

**Hot score:** a cron every 30 minutes recomputes
`(likes + 2·forks + comments + 1) / (age_hours + 2)^1.5` for lessons published
in the last 14 days, in the Worker (SQLite's `pow()` is optional), and writes
only rows that changed, also onto `lesson_tag`.

**Thai search:** FTS5 `unicode61` doesn't split Thai words. On write and on
query, the Worker splits text with `Intl.Segmenter('th', {granularity:'word'})`
and stores the words with spaces. workerd ships the Thai ICU data (checked
2026-10-07: `ทฤษฎีบทอัตราเร็วกึ่งกลาง` → `ทฤษฎีบท / อัตราเร็ว / กึ่งกลาง`).

**Migrations:** `drizzle-kit generate` writes `packages/db/drizzle/<ts>_<name>/`;
`scripts/flatten-migrations.ts` copies each to `packages/db/migrations/NNNN_<name>.sql`,
which `wrangler d1 migrations apply` reads. Custom SQL (FTS, the category seed)
goes in a `drizzle-kit generate --custom` migration.

**Backups:** D1 Time Travel (point-in-time restore) is the main backup. D1
can't export a database that has virtual tables, so an offsite export drops and
rebuilds the two FTS tables around the export (they are rebuilt from rows and
R2 bodies). Lesson and concept bodies in R2 are immutable, so they are their own backup.

---

## 6. Main flows

**Publish from pi**
1. pi's `learn` skill writes `lesson.json`, searches `GET /api/concepts?q=` to reuse
   shared concepts, and validates the lesson.
2. `/publish` sends `POST /api/lessons` (new) or `POST /api/lessons/:id/versions`
   (a new version, or a translation) with `Authorization: Bearer lrn_…`.
3. The Worker decodes the schema, checks the size, resolves shared concepts in
   the lesson's language, runs the validator, hashes the body and runs
   `PUT c/<hash>.json` on R2 (skipped if it exists).
4. One D1 batch inserts `lesson_version`, points `lesson_lang` at it, pins the
   concepts, rewrites the FTS row and recounts `concept.use_count`.
5. A new language must share every id with the original (otherwise 422 with the
   differences). Later versions of one language may move ahead of the other.
6. New lessons start **private**. Making one public needs a category and 1–5 tags.

**Read a lesson**
`GET /api/lessons/@handle/slug` returns metadata and the current version per
language (edge-cached for 60 s for anonymous readers). For a public or unlisted
lesson the client then fetches `GET /c/<hash>.json` (immutable, edge-cached; the
Worker serves a hash only if a public or unlisted lesson, or a concept, has it).
A private lesson is visible only to its owner (everyone else gets 404, so its
existence doesn't leak), and its body comes through `GET /api/lessons/:id/body/:lang`.
Then `GET /api/versions/:versionId/concepts` returns the pinned concepts
(immutable per version, so cached for a year).

**Fork:** this copies one row. The new lesson points at the same `body_hash`,
so R2 stores nothing new until the forker edits it. (Not built yet.)

**Ask about a chunk (`@ref`):** in phase 1 the web app copies a ready prompt
(question + referenced chunks as clean TeX) to paste into pi. Phase 2 sends it
to the learner's own key in the browser, and the answer can be saved as a new
card in their fork.

**Comments** can attach to any `@ref`. (Not built yet; the table exists.)

**Moderation and limits:** writes are rate-limited by the Workers Rate Limiting
binding (30 a minute, keyed by credential). Reports and comment hiding come with comments.

---

## 7. Stack: template vs this project

Keep: Bun workspaces, TypeScript strict, Effect 4.0.x, `HttpApi` +
`HttpApiClient`, Effect Schema, React + Vite, TanStack Router / Query, Base UI +
Tailwind v4, i18n (EN + TH), Better Auth, Biome, Vitest, Playwright, the Storage
seam (R2), keyset pagination.

Change (each one has an ADR in `docs/adr/`):

| Template | Here | Note |
|---|---|---|
| Postgres + Hyperdrive + `@effect/sql-pg` | **D1** + Drizzle's D1 driver, wrapped in an Effect `Db` service | Drizzle's Effect driver (rc.4) targets an Effect beta and crashes on 4.0.1, so queries are Promises run with `Effect.tryPromise` ([ADR 0007](adr/0007-drizzle-d1-driver.md)). |
| RLS + org tenancy | **No orgs.** Rules live in `packages/services`. | A service function for private data requires `CurrentUser` in its type. |
| Alchemy | **wrangler** (`apps/worker/wrangler.jsonc`) + `@cloudflare/vite-plugin` | `bun run dev` runs the Worker inside Vite. `wrangler d1 migrations apply` runs as its own step before deploy. |
| Queue + Postgres job table | none in v1 | add Queues or Workflows with hosted generation |
| Docker / Bun / on-prem entry | dropped | Cloudflare only |
| Better Auth org + SSO plugins, email + password | dropped. **Google sign-in only**, plus API tokens of our own for pi. | `drizzleAdapter(db, { provider: "sqlite" })`, `cookieCache` 5 min |
| Resend | none | no emails in v1 |
| Test DB in Docker | `wrangler`'s `getPlatformProxy()` | real local D1 + R2 (workerd) in Node; tests call the Worker's `fetch` |

**Repository layout**

```
apps/web            React SPA (home, guide, explore, library, reader, settings)
apps/worker         Worker entry: HttpApi handlers, session middleware, /c/ bodies,
                    edge cache, cron; wrangler.jsonc; integration tests; seed:local
packages/domain     LessonSpec + ConceptSpec schema (the pi contract), API models and
                    errors, Rich parser, expression parser, validator
packages/api        HttpApi definitions + Session middleware tag (shared by worker and web)
packages/db         Drizzle schema, migrations, the Db service, crypto helpers
packages/auth       Better Auth config (Google only), profile on first sign-in
packages/services   Lessons, Concepts, Profiles, Tokens, hot score
packages/ui         Linear tokens, Base UI wrappers, i18n
packages/lesson     renderer + widget catalog + Rich/TeX (+ a playground)
content/            platform content: the guide (en, th) and shared concepts
e2e/                Playwright smoke + widget overlap audit
```


---

## 8. UI: Linear style

Source: `docs/linear-DESIGN.md`. Tokens go into `packages/ui` as Tailwind v4
`@theme` variables.

- **Canvas** `#010102`, surfaces `#0f1011 → #191a1b`, hairlines `#23252a / #34343a`.
  Depth comes from the surface steps and 1px borders. No shadows, no gradients.
- **Text** `#f7f8f8` / muted `#d0d6e0` / subtle `#8a8f98` / tertiary `#62666d`.
- **One accent:** lavender `#5e6ad2` (hover `#828fff`), only for the primary
  button, focus ring, links and selected state.
- **Type:** Inter for UI (Linear's fonts are private), JetBrains Mono for code.
  Self-host the fonts in assets. Body 14–16 px, dense 13 px for lists, 8 px
  radius on buttons and inputs, 12 px on cards, 4 px spacing grid.
- **App layout:** left sidebar (Library, Explore, categories tree, tags you
  follow), list rows like Linear issues (kind icon · title · tags · author ·
  ♥ · forks), `⌘K` command menu. The command menu is also the `@ref` search,
  so one pattern does both.
- **Lesson colors live only inside lesson content.** Linear allows one
  accent in the app UI, but lessons need many role colors. So the app UI stays
  lavender only, and the reader panel uses a role palette tuned for the dark
  canvas (equal lightness in OKLCH so no color shouts). The palette is based on
  Linear's product label colors (teal, red, mustard, yellow, orange, purple,
  blue, green). One color = one meaning, as the pi session agreed.
- **Light mode:** Linear doesn't define one. Ship dark first. Add light later
  with the inverse tokens and a second, darker role palette.

---

## 9. Build order

1. **Scaffold** from the template with the changes in section 7. Deploy
   to learn.sirin.dev with D1 + R2 bound. Sign in with Google.

Status (2026-10-07): steps 1–3 and most of 4 are built (no likes, bookmarks,
forks or profile pages yet). Deploy is waiting on the one-time Cloudflare setup
in the README.
2. **LessonSpec + renderer:** port the 5 prototype tabs into `packages/lesson`
   as specs + widgets. Keep `audit.js` green in CI.
3. **Library:** private lessons, publish API + API tokens, pi `/publish`.
4. **Community:** public/unlisted, categories, tags, explore feeds, likes,
   bookmarks, fork, search, profiles.
5. **Comments on `@refs`**, reports, rate limits.
6. **Phase 2:** in-browser generation with your own key, lazy drill-down cards,
   "found an existing lesson" check before generating.
7. **Later, only when needed:** hosted generation (Queues/Workflows + AI
   Gateway caching), Vectorize for "similar lessons", Durable Objects for live
   study rooms.

## 10. Open questions

Answered while building the scaffold (2026-10-07):

- drizzle-kit migration layout vs `wrangler d1 migrations apply`: they don't match
  (folders vs flat files), so `packages/db/scripts/flatten-migrations.ts` copies them.
  Checked: both migrations apply locally.
- Better Auth on D1: the drizzle sqlite adapter over Drizzle's D1 driver, shared
  with the services.
- `Intl.Segmenter` with Thai in workerd: works (see §5).

Still open:

- Should FTS live in a second D1 database to keep exports simple? For now the
  export drops and rebuilds the FTS tables.
- Are unlisted lessons enough for "share with a friend", or do we need invite links?
- License for shared lessons (suggest CC BY-SA, with forks credited).
- Who may edit a shared concept? In v1 only its author; later perhaps
  suggestions, or a small group of maintainers per category.
