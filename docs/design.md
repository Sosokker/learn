# Learn — design

Status: draft for review, 2026-10-07. Sections 4–7 and 10 were updated to match
the code on 2026-10-07; the code wins where they differ.
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
| Auth | Better Auth, **Google sign-in only**, no passwords | No email service to pay for, and no password hashing on Worker CPU |
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
| Worker requests | ~10M/mo (`/api/*` and `/c/*` run the Worker first, so edge cache hits count too; a hit only skips D1 and R2) | inside $5 |
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
   After the first read in a region, the Worker answers it from the edge cache
   (`caches.default`). `/c/*` runs the Worker first (`run_worker_first`), so a
   hit is still a Worker request, but it reads no R2 object and no D1 row.
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

The contract between pi, the server and the renderer is the Effect Schema in
`packages/domain/src/lesson.ts`. This section is a summary. When it disagrees
with that file, the file wins.

- `decodeLesson` / `decodeConcept` (`codec.ts`) decode strictly: an unknown key
  is an error, so a typo such as `whynot` fails instead of losing the field.
- `lessonJsonSchema()` / `conceptJsonSchema()` export JSON Schema (draft
  2020-12) for pi. It covers shapes, enums, id patterns and length caps.
  References and expressions are checked only by the validator.
- `validateLesson` (`validate.ts`) checks what the schema cannot say. The
  server runs it on publish, pi can run it offline, and the content test runs it
  on `content/**`.

### 4.1 Shape

```ts
LessonSpec {
  schema: 1
  kind: "solve" | "learn" | "situation" | "code" | "proof" | "guide"
  lang: "en" | "th"
  title: string                       // 1–160 chars
  summary: string                     // ≤ 280 chars, shown in feeds
  parts:    Record<PartId, Part>      // colored things, linked everywhere
  cards:    Record<CardId, CardEntry> // a local card, or a pointer to a shared concept
  sections: Section[]                 // ordered page content
}

Part      { label: Rich, role: Role, color: RoleColor, meaning: string /* ≤ 200 */,
            body?: Rich, example?: Rich, analogy?: Rich }
Role      = given | hidden_given | goal | derived | constant | condition
          | actor | metric | variable | concept
RoleColor = red | orange | peach | yellow | mustard | olive | green | teal
          | cyan | blue | purple | pink | rose | grey      // tokens, not hex
CardEntry = Card | { concept: "<slug>" | "<slug>@<n>" }
Card      { kind: term | law | formula | def | lemma | thm | metric | story | feature,
            title: Rich, kicker?: string /* ≤ 60 */, body: Rich,
            says?, from?, useWhen?, units?, example?, analogy?: Rich }
```

There is no top-level `problem` field. The problem is a `problem` section.

Every section has `id`, an optional `title` (≤ 120) and an optional `note`
(≤ 200).

| `type` | Fields | Items (`@ref`-able) |
|---|---|---|
| `text` | `body: Rich` | – |
| `problem` | `body: Rich` | – |
| `chunks` | `rows: { id, text, role, note }[]` | rows |
| `concept` | `concept: Rich, field: Rich, prerequisites: CardId[]` | – |
| `plan` | `routes: { id, title, path, why, whyNot, picked }[], notUsed?` | routes |
| `chain` | `steps: Step[]` | steps |
| `proof` | `goal: Rich, lines: ProofLine[]` | lines |
| `graph` | `nodes: { id, label ≤ 60, kind, needs: id[], card?, part? }[]` | nodes |
| `visual` | `widget: Widget` (4.4) | – |
| `check` | `items: Rich[]` | – |
| `story` | `events: { id, year?, text }[]` | events |
| `units` | `units: { id, title, milestone, lessonSlug? }[]` | units |
| `recall` | `questions: { id, q, options: Rich[], answer: int, why }[]` | questions |

```ts
Step      { id, move: Rich, formula?: Tex, why: Rich, whyNot?: Rich, uses: PartId[] }
ProofLine { id, claim: Rich, why: Rich, intuition?: Rich, whyNot?: Rich, deps: LineId[] }
GraphNodeKind = goal | lemma | thm | law | def | part | step
```

**IDs.** Part, card, section, item and param ids match
`^[a-z][a-z0-9_]{0,31}$` (`idPattern`). They are identical in every language
of a lesson, so `@ref`s and comment anchors work in all of them.

**Size caps.** `Rich` ≤ 8,000 chars, `Tex` ≤ 4,000, an expression ≤ 300,
`trace.code` ≤ 4,000. A whole lesson is ≤ 512 KB (`maxLessonBytes`). The
`BodyLimit` middleware refuses a bigger request before it is parsed, and
publish checks the size again.

### 4.2 Rich text

`packages/domain/src/rich.ts` parses it with a fixed grammar. The parser is
total: it never throws. Anything it can't match (an unclosed `$`, a `[` that is
not `[id:`, a lone `*`) stays plain text. There is no HTML. The renderer builds
every element itself.

| Markup | Meaning |
|---|---|
| `[partId:label]` | Link to a part. The label may hold math, bold, italic and code. |
| `{cardId\|label}` | Link to a card (drill-down) |
| `$tex$` | Inline math (KaTeX). Empty math is not math. |
| `$$tex$$` | Display math |
| `**bold**`, `*italic*`, `` `code` `` | Emphasis and code |
| `\x` | A literal character. Escapable: backslash, `$`, `*`, backtick, `[`, `]`, `{`, `}`, `\|`, `_` |
| a blank line | A paragraph break |
| `\p{partId}{tex}` (inside TeX only) | A hoverable symbol linked to a part |

- `@slug/section.item` references go inside `` `code` `` spans. To the parser
  they are plain code.
- KaTeX runs with `trust` limited to `\htmlData` with one `data-p` attribute
  whose value matches the id pattern. `\p{id}{…}` expands to that.

**Drill-down comes from links.** The child cards of a card are the `{card}`
links inside it. For a shared concept card, the children are the concept's
`needs`. That is how the "where this sits" tree works, so pi only writes links.

### 4.3 Validation

`validateLesson` returns a list of `{ path, code, message }`. An empty list
means the lesson can be published.

| Code | When |
|---|---|
| `bad_id` | A record key is not an id, or a param id is reserved (`x`, `pi`, `e`, a function name) |
| `duplicate_id` | Two sections, two items in one section, two params or two flow nodes share an id |
| `unknown_part` | `[part:]`, `\p{part}`, `uses`, or a widget, graph or param `part` has no part |
| `unknown_card` | `{card\|}`, a `prerequisites` entry or a `card` binding has no card |
| `unknown_concept` | A `{ concept }` entry does not resolve (server only) |
| `unknown_ref` | A proof dep, graph need, flow edge end or `incline.parts` key has no target |
| `forward_dep` | A proof line depends on itself or a later line |
| `cycle` | A graph section has a cycle |
| `bad_expr` / `unknown_var` | A plot expression does not parse, or uses a name that is not allowed there |
| `bad_range` | min/max/step/value, axis ranges, recall `answer`, table row width or trace `line` is out of range |
| `not_allowed` | Markup a field may not use (a shared concept card with part or card links) |
| `parity` | Two languages of one lesson differ in structure, or `kind` differs |

**Translation parity.** `compareTranslations` checks that two languages have
the same ids, section types, links and widget shapes. Only prose may differ.
On publish, the server compares the new body with the current version of every
other language of that lesson.

### 4.4 Widgets

A closed catalog. A shared lesson can't run code.

| Widget | Fields | Drawn with |
|---|---|---|
| `plot` | `x`, `y` axes; `params` (sliders); `curves` (`expr` in `x` and params); `points` (`x`, `y` exprs in params); `readouts` (label = expr, unit) | Plain SVG + the safe expression parser |
| `table` | `head: Rich[]`, `rows: Rich[][]` (each row as wide as `head`) | HTML table |
| `flow` | `nodes: { id, label, part?, card? }[]`, `edges: { from, to, label?, part? }[]` | React Flow + dagre, lazy-loaded |
| `incline` | `params`; `forces` ⊆ `weight, normal, friction, accel`; `parts`: force name → part id | SVG, physics in `incline-math.ts` |
| `trace` | `code`, `lang`, `steps: { line, note, state: Record<string, string> }[]` | Code view + step slider |

The `graph` section also uses React Flow + dagre. dagre and React Flow load
only in the lazy diagram chunk.

`Param { id, label, min, max, step, value, part? }`. The rules are
`min < max`, `step > 0` and `min ≤ value ≤ max`.

**Expressions** (`packages/domain/src/expr.ts`) are parsed to an AST and
compiled to a closure. There is no `eval`, no `Function` and no property
access. Allowed: numbers, `+ - * / ^` (`^` is right-associative, `-x^2` is
`-(x^2)`), unary minus, parentheses, `pi`, `e`, param ids, `x` (curves only),
and the functions `sin cos tan asin acos atan atan2 sinh cosh tanh sqrt cbrt
abs exp ln log log2 floor ceil round sign pow mod min max hypot` (`log` is
base 10).

**Renderer conventions** (not in the schema, so write them this way):

- `incline` finds its params by id: angle `theta` | `th` | `angle` (degrees),
  friction `mu` | `mu_k`, mass `m` | `mass`, distance `d` | `dist`, gravity
  `g`. A missing one uses a default (θ 30, μ 0.2, m 2, d 5, g 9.8).
- `incline.parts` keys are force names (`weight`, `normal`, `friction`,
  `accel`), and each must also be in `forces`.
- `trace` step lines are 1-based.

Planned in the first draft but **not built**: `freebody`, `dag` (the `graph`
section covers it), `timeline`, `lattice`, `popcorn`, `scene`. The prototype's
`audit.js` overlap check is not in CI yet.

### 4.5 Shared concepts

A concept such as `physics.newton-second-law` is written once and reused by
many lessons. The lesson-writing agent searches `GET /api/concepts?q=` before it
writes a card, so it reuses a concept instead (fewer tokens, one consistent
explanation).

```ts
ConceptSpec {
  schema: 1
  slug: string        // ^[a-z0-9-]+(\.[a-z0-9-]+){1,4}$, e.g. physics.average-speed
  lang: "en" | "th"
  card: Card
  needs: ConceptSlug[] // prerequisites: the global concept graph
  aliases: string[]    // other names people search for, ≤ 80 chars each
}
```

A lesson keeps its own local card id and points it at the concept, so
`{newton2|…}` links still work:

```json
"cards": { "newton2": { "concept": "physics.newton-second-law" } }
```

- `"slug"` pins the current version of the lesson's language at publish time.
  `"slug@2"` pins version 2 of that language.
- The pin is a row in `lesson_version_concept`. A later concept version never
  changes an existing lesson version.
- A concept card may not link to parts or cards (`not_allowed`). It names its
  prerequisites in `needs` instead.
- `needs` must exist and must not form a cycle. The server checks this with a
  recursive query before it writes.
- At most 32 `needs` per concept and 64 `cards` per lesson (`maxConceptNeeds`,
  `maxCards`): the server looks them up in one `in (…)` query, and D1 allows
  100 bound parameters per statement. More is a 422 from the schema.
- Slugs under `platform.` are reserved for the platform user `learn`.
- Only the user who created a concept can add versions (403
  `ConceptForbidden`). All languages of a concept must agree on `card.kind` and
  `needs`.
- A concept body is ≤ 64 KB. Bodies are public and live in R2 at
  `c/<sha256>.json`, like lesson bodies.

### 4.6 Stable reference ids

A reference is `@<lessonSlug>/<sectionId>` or `@<lessonSlug>/<sectionId>.<itemId>`,
for example `@start-here/chain.s2` (`buildRef` in `packages/lesson/src/refs.ts`).
Parts and cards have no `@ref`. In the "ask" prompt they are named
`part:<id>` and `card:<id>`. The prompt quotes the lesson title and each
piece in its own fenced block, with a fence longer than any backtick run in
it, after a note that the quoted text is untrusted lesson text and not
instructions. A lesson author writes that text, so it must not be able to
pass as the learner's own words.

---

## 5. Database model (D1)

Tables are Drizzle `sqlite-core` in `packages/db/src/schema.ts` (app) and
`packages/db/src/auth-schema.ts` (Better Auth). This section lists them. The
code is the source of truth.

Conventions: ids are UUIDv7 text (sortable by time). Times are integer epoch
milliseconds. Enumerations are checked text. Columns are snake_case.

### 5.1 Tables

| Table | Key columns | Notes |
|---|---|---|
| `user`, `session`, `account`, `verification`, `rate_limit` | Better Auth | Only `packages/auth` and `packages/db` may import `@app/db/auth-schema` (Biome rule). |
| `profile` | `user_id` PK, `handle` unique, `bio`, `lesson_count`, `created_at` | Made on first sign-in. `lesson_count` counts public lessons. |
| `category` | `id` PK = dotted path (`physics.mechanics`), `parent_id`, `name_en`, `name_th`, `sort` | Seeded by migration `0003`, which includes `platform.guide`. There is no `slug` column: the id is the slug. |
| `lesson` | `owner_id`, `slug` (unique per owner), `kind`, `default_lang`, `title`, `summary`, `category_id`, `visibility`, `forked_from_version_id`, `problem_hash`, counters, `hot_score`, `published_at`, `deleted_at` | `default_lang` is the first language published; feeds show its title and summary. No `current_version_id` and no `draft_key`. |
| `lesson_version` | `lesson_id`, `lang`, `n`, `body_hash`, `body_bytes`, `schema`, `note` | Immutable. `unique(lesson_id, lang, n)`: numbered per language (en v1, en v2, th v1). |
| `lesson_lang` | PK `(lesson_id, lang)`, `version_id`, `title`, `summary`, `updated_at` | The current version of each language. |
| `tag` | `slug` unique, `name`, `lesson_count` | Slug: NFC, lowercase, runs of non-letters/digits become one `-`, ≤ 40. Thai letters stay. |
| `lesson_tag` | PK `(lesson_id, tag_id)`, `is_public`, `published_at`, `hot_score` | Copies from `lesson`, kept in sync in the same batch, so a tag feed reads one index. ≤ 5 tags per lesson. |
| `concept` | `slug` unique, `owner_id` | |
| `concept_version` | `concept_id`, `lang`, `n`, `body_hash`, `body_bytes` | Immutable. `unique(concept_id, lang, n)`. |
| `concept_lang` | PK `(concept_id, lang)`, `version_id`, `kind`, `title`, `aliases` (JSON), `search` | Current version per language. `search` holds the indexed text (Thai already split into words). |
| `concept_need` | PK `(concept_id, need_id)` | Prerequisite edges of the current versions. Acyclic. |
| `lesson_version_concept` | PK `(lesson_version_id, card_id)`, `concept_version_id` | The concept version each `{ concept }` card was pinned to at publish. |
| `concept_fts` | FTS5 `(concept_id UNINDEXED, lang UNINDEXED, search)`, `unicode61 remove_diacritics 2` | Hand-written migration `0002`. A regular (not contentless) FTS table. |
| `lesson_like`, `bookmark`, `comment`, `progress`, `api_token`, `report` | as in the first draft | Tables exist. **No service or endpoint uses them yet.** |

There is no `lesson_fts` yet. Lesson search is not built.

### 5.2 Indexes

D1 bills rows scanned, so every list query has an index that covers it. Feed
indexes are partial and hold public rows only. Index columns are ascending:
SQLite walks an index backwards for `order by published_at desc, id desc`.

| Index | On | Used by |
|---|---|---|
| `lesson_new_idx` | `lesson (published_at, id)` where public and not deleted | `/api/feeds/new` |
| `lesson_hot_idx` | `lesson (hot_score, id)` where public | a hot feed (not built yet) |
| `lesson_cat_idx` | `lesson (category_id, published_at, id)` where public | `/api/feeds/categories/:id` |
| `lesson_kind_idx` | `lesson (kind, published_at, id)` where public | a kind filter (not built yet) |
| `lesson_owner_idx` | `lesson (owner_id, updated_at, id)` | `/api/me/lessons` |
| `lesson_problem_idx` | `lesson (problem_hash)` where not null | reuse check (not built yet) |
| `lesson_tag_feed_idx`, `lesson_tag_hot_idx` | `lesson_tag (tag_id, published_at \| hot_score, lesson_id)` where `is_public = 1` | `/api/feeds/tags/:slug` |
| `lesson_version_hash_idx`, `concept_version_hash_idx` | `body_hash` | `/c/<hash>.json` access check |

Lists are keyset pages: an opaque base64url cursor of `{ at, id }`, `limit`
1–50 (default 20). Never `OFFSET`, never `COUNT(*)` for totals.

### 5.3 Writes, counters and the cron

- A D1 batch is one transaction. Every multi-row change is one
  `Database.batch`.
- Counters (`tag.lesson_count`, `profile.lesson_count`) are recounted from the
  index with a subquery in the same batch, so they cannot drift.
- Hot score: the cron (`*/30 * * * *`) recomputes
  `(likes + 2·forks + comments + 1) / (age_hours + 2)^1.5` for lessons first
  made public in the last 14 days, rounded to 6 places. It writes only rows
  whose score changed, and copies the score to `lesson_tag`.

### 5.4 Thai search

FTS5 `unicode61` does not split Thai words. Before the text is stored,
`searchText` splits Thai with `Intl.Segmenter('th', { granularity: 'word' })`.
`ftsQuery` splits the query the same way and quotes every word, so FTS syntax
in user input does nothing. The last word may be a prefix. workerd ships the
Thai word dictionary: `apps/worker/test/workerd.test.ts` checks it in a real
workerd isolate.

### 5.5 Migrations, backups and exports

- drizzle-kit 1.0 writes folders (`packages/db/drizzle/<timestamp>_<name>/`).
  `wrangler d1 migrations apply` reads flat files. `bun run db:generate` runs
  drizzle-kit, then `packages/db/scripts/flatten-migrations.ts` copies each
  folder to `packages/db/migrations/NNNN_<name>.sql`. The script refuses to
  rename or rewrite a file that exists. See `packages/db/README.md`.
- Hand-written SQL (FTS5, seed rows) starts with
  `bunx drizzle-kit generate --custom --name=<name>`, so the snapshot chain
  stays whole.
- D1 Time Travel is the main backup. Lesson and concept bodies in R2 are
  immutable, so they are their own backup.
- `wrangler d1 export` refuses a database with virtual tables. `concept_fts`
  stays in the main database (so a concept write and its index update are one
  batch). It is derived data: drop it, export, then recreate it and refill it
  from `concept_lang.search` with one statement (see `packages/db/README.md`).

---

## 6. Main flows

### 6.1 Sign in

Better Auth owns `/api/auth/*`. Google is the only provider.

1. The SPA starts Google sign-in. Google calls back to
   `<BETTER_AUTH_URL>/api/auth/callback/google`.
2. On the first sign-in, a database hook makes a `profile` row with a unique
   handle: the Latin letters of the Google name, else `user_<6 random base32>`,
   plus a number if taken. The email is never used, so a handle never shows an
   address. Reserved words (`reservedHandles` in `packages/api`: `learn`,
   `admin`, `api`, `c`, `explore`, `me`, …) are never handles. The user changes
   the handle with `PATCH /api/me` (library page). If the hook fails, the next
   session repairs it.
3. The session cookie has a 5-minute signed cookie cache, so most signed-in
   requests read no session row.
4. A state-changing request (POST, PATCH, DELETE) with a session is refused with
   403 `CrossSiteRequest` when `Sec-Fetch-Site` is `cross-site` or `same-site`,
   or when `Origin` is not `BETTER_AUTH_URL` or one of
   `BETTER_AUTH_TRUSTED_ORIGINS`.
5. A state-changing request also spends the user's write budget (Workers Rate
   Limiting binding `WRITE_LIMIT`, 30 per 60 s, keyed by user id). Over it is
   429 `RateLimited`. Without the binding (tests) nothing is limited.
6. Google tokens are stored encrypted (`encryptOAuthTokens`). Account linking
   is off: a Google sign-in whose email matches an existing user without that
   Google account is refused. The platform user `learn` can never get a
   session or an account (auth hooks).

### 6.2 Publish a lesson version

`POST /api/me/lessons/:slug/versions`, body = one LessonSpec JSON, signed in
with the session cookie.

1. `BodyLimit` refuses a body over 512 KB (413).
2. The body must be UTF-8 JSON, decode strictly, and pass `validateLesson` with
   concept resolution. If the lesson exists, `kind` must match and the body
   must pass `compareTranslations` against every other language. Any problem
   is 422 `InvalidLesson` with the full issue list.
3. The decoded spec is serialized again (`canonicalJson`), so formatting
   differences don't make a new body. Its sha256 is the R2 key `c/<hash>.json`.
   The put is skipped if the object exists.
4. One D1 batch: insert `lesson` on the first publish (private, `default_lang` =
   this language), insert `lesson_version` with the next `n` of this language,
   upsert `lesson_lang`, update the lesson's title and summary if this is the
   default language, and insert one `lesson_version_concept` row per
   `{ concept }` card.
5. 201 with `{ lesson, version }`.

**pi cannot call this yet.** It needs a session cookie. API tokens (the
`api_token` table) and a bearer middleware are not built.

### 6.3 Settings, visibility and delete

`PATCH /api/lessons/:id` with any of `visibility`, `category_id`, `tags`. Owner
only. Anyone else gets the same 404 as for a missing lesson.

| Visibility | Who can read | In feeds | Body at `/c/<hash>.json` |
|---|---|---|---|
| `private` (default) | the owner only; **everyone else gets 404** | no | no, not even for the owner |
| `unlisted` | anyone with the link | no | yes |
| `public` | anyone | yes | yes |

- Making a lesson public needs a category, at least 1 tag and a published
  version (422 `InvalidSettings` otherwise).
- `published_at` is set the first time the lesson becomes public and never
  reset. Feeds sort by it.
- `DELETE /api/lessons/:id` is a soft delete. It sets `deleted_at`, makes the
  lesson private and renames the slug to `<slug>~<id>`, so the owner can reuse
  the slug. Bodies stay in R2, because another lesson may share the hash.

**The access rule lives in the type.** `Lessons.anonymous` is a
`LessonReads<never>`, and it can only see non-private lessons.
`Lessons.asUser` is a `LessonReads<CurrentUser>`, and it can also see the
viewer's own private lessons. So code without a `CurrentUser` in its Effect
type can't read a private lesson.

### 6.4 Read a lesson

1. `GET /api/lessons/by/:handle/:slug` (or `/api/lessons/:id`) returns the
   metadata, with `langs[]`: one entry per language, with its `version_id`
   and `body_hash`.
2. The body:
   - public or unlisted: `GET /c/<hash>.json`. It is immutable and cached
     (6.5).
   - private (owner only): `GET /api/lessons/:id/versions/:versionId/body`,
     sent as `private, no-store`.
3. The pinned concepts: `GET /api/lessons/:id/versions/:versionId/concepts`
   returns every `{ concept }` card's pinned version with its spec. Pins never
   change, so for a public or unlisted lesson it is sent as `public,
   max-age=31536000, immutable` and kept in the edge cache like `/c/` (same
   caveat as 6.5). A private lesson's bundle is `private, no-store`.
4. The browser renders it with `<Lesson>` from `packages/lesson`.

### 6.5 `/c/<hash>.json`

- A hash is served only if it belongs to a version of a public or unlisted
  lesson that is not deleted, or to any concept version. Anything else is 404
  (`ContentAccess`).
- The response has `Cache-Control: public, max-age=31536000, immutable`,
  `nosniff` and `Access-Control-Allow-Origin: *`. The Worker also puts it in
  `caches.default`, keyed by the path alone (a query string or cookie can't
  make a new entry). A later read in that region still runs the Worker, but
  not the app, R2 or D1. The Cache API needs the custom domain. On
  `workers.dev` it does nothing.
- **Caveat:** after a body has been served, browsers and the edge can keep it
  for up to a year, even if the lesson later becomes private or is deleted.
  The URL can't be guessed, but anyone who already has it keeps it. Private
  bodies never go through `/c/`, so a lesson that was never unlisted or public
  is not affected. See ADR 0003.

### 6.6 Feeds and concept search

- `GET /api/feeds/new`, `/api/feeds/categories/:id` (the category and every
  category under it) and `/api/feeds/tags/:slug` return public lessons,
  newest first, in keyset pages. An unknown tag is an empty page, like a tag
  used only by private lessons, so the feed can't tell them apart.
- Names under `platform.` (concept slugs and the `platform` category tree)
  are only for the platform user `learn`.
- `GET /api/concepts?q=&lang=&limit=` is full-text search over slug words,
  aliases and card text. `GET /api/concepts/:slug` returns one concept with
  its languages and needs. `POST /api/concepts` (body = one ConceptSpec)
  creates a concept or adds the next version of its language.

### 6.7 API routes

All routes are under `/api` (`packages/api/src/api.ts`). The OpenAPI document
is at `/api/openapi.json`.

| Method and path | Access | What it does |
|---|---|---|
| `GET /health` | anyone | Liveness |
| `GET /health/ready` | anyone | D1 answers (503 `NotReady` if not) |
| `GET /me` | signed in | The user and their profile |
| `PATCH /me` | signed in | Change the handle (409 `HandleTaken`, 422 `InvalidHandle` for reserved) |
| `GET /categories` | anyone | The whole category tree (flat; build it from `parent_id`) |
| `GET /lessons/:id` | viewer | One lesson. Private: owner only, else 404. |
| `GET /lessons/by/:handle/:slug` | viewer | The same, by URL |
| `GET /lessons/:id/versions?lang=` | viewer | Versions, per language, newest first |
| `GET /lessons/:id/versions/:versionId/body` | viewer | The stored body bytes, `no-store` |
| `GET /lessons/:id/versions/:versionId/concepts` | viewer | Pinned concepts with their specs |
| `PATCH /lessons/:id` | owner | Visibility, category, tags |
| `DELETE /lessons/:id` | owner | Soft delete |
| `GET /me/lessons` | signed in | The user's library, all visibilities, by `updated_at` |
| `POST /me/lessons/:slug/versions` | signed in | Publish (6.2) |
| `GET /feeds/new` | anyone | Public lessons, newest first |
| `GET /feeds/categories/:id` | anyone | One category and its children |
| `GET /feeds/tags/:slug` | anyone | One tag |
| `GET /concepts?q=` | anyone | Concept search |
| `GET /concepts/:slug` | anyone | One concept |
| `POST /concepts` | signed in | Create a concept or add a version |
| `* /auth/*` | Better Auth | Google sign-in, callback, session, sign-out |

Outside `/api`: `GET /c/<sha256>.json` (6.5). All other paths are static
assets, and unknown paths get the SPA's `index.html`.

### 6.8 Not built yet

- API tokens and a bearer middleware, and pi's `/publish` extension.
- Likes, bookmarks, comments on `@ref`s, progress, reports. The tables exist,
  but there are no services or endpoints.
- Lesson search (`lesson_fts`), the reuse check by `problem_hash`, and fork.
- A hot feed endpoint, and kind/lang filters on feeds. The hot score cron
  runs already.
- The 60-second edge cache for anonymous feeds.
- Drafts in R2, and the "ask" answer saved as a card (phase 2). In phase 1,
  the reader copies a prompt for pi (`buildPrompt` in `packages/lesson`).
- Moderation: hide comments, admin list of reports.

---

## 7. Stack: template vs this project

Kept from the template: Bun workspaces, TypeScript strict, Effect 4.0.1,
`HttpApi`, Effect Schema, React + Vite, TanStack Router and Query, Base UI +
Tailwind v4, i18n (EN + TH), Better Auth, Biome, Vitest + `@effect/vitest`,
Playwright, the Storage seam (R2 here), keyset pagination.

| Template | Here | Note |
|---|---|---|
| Postgres + Hyperdrive + `@effect/sql-pg` | **D1** + `@effect/sql-d1` 4.0.1 | Drizzle (`1.0.0-rc.4`, `sqlite-proxy`) only compiles SQL with `.toSQL()`. `Database` in `packages/db` runs it and decodes rows with Effect Schema. ADR 0001. |
| RLS + org tenancy | **No orgs.** Owner and visibility rules live in `packages/services`. | Reads that can see private lessons need `CurrentUser` in their type (6.3). |
| Alchemy | **wrangler** (`apps/worker/wrangler.jsonc`) + `@cloudflare/vite-plugin` | Migrations run as their own step before `wrangler deploy`. ADR 0002. |
| Queue + Postgres job table | none | One cron trigger (hot score). |
| Docker / Bun / on-prem entry | dropped | Cloudflare only |
| Better Auth orgs, SSO, email + password | **Google only**, on the native D1 binding | Better Auth 1.7 sees the D1 binding and uses its built-in Kysely D1 dialect. No Drizzle adapter. ADR 0007. |
| Resend | none | No emails in v1 |

**Repository layout**

```
apps/web            React SPA (reader, library, explore, profile)   -> api, domain, lesson, ui
apps/worker         Worker entry, HTTP handlers, session middleware, R2 layer; wrangler.jsonc,
                    scripts/seed-local.ts, tests on Miniflare        -> api, auth, db, domain, services
packages/domain     LessonSpec + ConceptSpec schemas, Rich parser, expression parser, validator,
                    JSON Schema export (pure, no IO)
packages/api        HttpApi definition, models, errors, middleware tags   -> domain
packages/db         Drizzle sqlite schema, migrations, Database layer     -> domain
packages/auth       Better Auth config, profile hook, secret rules        -> db, domain
packages/services   Lessons, Concepts, Feeds, Categories, Profiles, ContentAccess, HotScore, Storage seam
packages/ui         Linear tokens, fonts, role colors, Base UI wrappers, app i18n
packages/lesson     The renderer: sections, widgets, inspector, Rich/TeX, @ref prompts
content/            The "Start here" guide (en, th) and shared concepts, seeded by seed:local
e2e/                Playwright
```

There is no `tools/pi` yet.

**wrangler.jsonc (as built)**

- `main: src/worker.ts`, `compatibility_flags: ["nodejs_compat"]` (Better Auth
  needs `AsyncLocalStorage`).
- Route `learn.sirin.dev` as a custom domain.
- Assets from `../web/dist` with SPA fallback. `run_worker_first` is
  `["/api/*", "/c/*"]`. Every other path is an asset.
- D1 binding `DB` (database `learn`, migrations from
  `../../packages/db/migrations`). R2 binding `CONTENT` (bucket
  `learn-content`).
- Cron `*/30 * * * *`. Observability on. Var `BETTER_AUTH_URL`.
- Secrets: `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
  Locally they come from `apps/worker/.dev.vars`.
- `ratelimits` binding `WRITE_LIMIT` (30 per 60 s), per user, on
  state-changing API requests.

---

## 8. UI: Linear style

Source: `docs/linear-DESIGN.md`. Tokens go into `packages/ui` as Tailwind v4
`@theme` variables.

- **Canvas** `#010102`, surfaces `#0f1011 → #191a1b`, hairlines `#23252a / #34343a`.
  Depth comes from the surface steps and 1px borders. No shadows, no gradients.
- **Text** `#f7f8f8` / muted `#d0d6e0` / subtle `#8a8f98` / tertiary `#62666d`.
- **One accent:** lavender `#5e6ad2` (hover `#828fff`), only for the primary
  button, focus ring, links and selected state.
- **Type:** Inter for UI (Linear's fonts are private), IBM Plex Sans Thai for
  Thai, JetBrains Mono for code (all from `@fontsource`).
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
   "hello" to learn.sirin.dev with D1 + R2 bound. Sign in with Google.
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

Answered while building (2026-10-07):

- **drizzle-kit layout vs `wrangler d1 migrations apply`:** they don't match.
  drizzle-kit keeps writing folders in `packages/db/drizzle/`, and
  `packages/db/scripts/flatten-migrations.ts` copies them to flat
  `packages/db/migrations/NNNN_<name>.sql` files for wrangler (5.5).
- **Better Auth on D1:** the native binding. Better Auth 1.7 detects the D1
  binding and uses its built-in Kysely D1 dialect, so there is no Drizzle
  adapter (ADR 0007).
- **`Intl.Segmenter('th')` in workerd:** it works. workerd ships the Thai word
  dictionary. `apps/worker/test/workerd.test.ts` checks it.
- **FTS in a second database:** no. `concept_fts` stays in the main database,
  so a write and its index update are one batch. It is derived data and can be
  rebuilt from `concept_lang.search` after an export (5.5).

Still open:

- Are unlisted lessons enough for "share with a friend", or do we need invite links?
- License for shared lessons (suggest CC BY-SA, with forks credited).
- How pi authenticates to publish: API tokens are planned (`api_token` table)
  but not built (6.8).
