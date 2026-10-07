# Learn — design

Status: draft for review, 2026-10-07.
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
| Auth | Better Auth, **Google + GitHub sign-in only**, no passwords | No email service to pay for, and no password hashing on Worker CPU |
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

This is the prototype's ad-hoc JS (`part()`, `card()`, `more()`, `graph()`,
`proofBlock()`) made into data.

```ts
LessonSpec {
  schema: 1                          // the renderer upgrades old versions on read
  kind: "solve" | "learn" | "situation" | "code" | "proof"
  lang: "en" | "th"
  title: string
  summary: string                    // ≤ 280 chars, shown in feeds
  problem?: Rich                     // the original question

  parts:  Record<PartId, Part>       // colored things, linked everywhere
  cards:  Record<CardId, Card>       // terms, laws, formulas, definitions, stories
  sections: Section[]                // ordered page content
}

Part  { label: Rich, role: Role, color: RoleColor, meaning: string,
        body?: Rich, example?: Rich, analogy?: Rich }
Role  = given | hidden_given | goal | derived | constant | condition
      | actor | metric | variable | ...            // closed list, grows by schema version
Card  { kind: term | law | formula | def | lemma | thm | metric | story,
        title: Rich, kicker?: string, body: Rich,
        says?, from?, useWhen?, units?: Rich,        // the formula card fields
        example?: Rich, analogy?: Rich }

Section =
  | { type: "chunks",  rows: { text: Rich, role: Role, note: Rich }[] }
  | { type: "concept", concept: Rich, field: Rich, prerequisites: CardId[] }
  | { type: "plan",    routes: { id, title, path: Rich, why: Rich, whyNot: Rich, picked: boolean }[],
                       notUsed?: Rich }
  | { type: "chain",   route: string, steps: Step[] }
  | { type: "proof",   id, title, lines: ProofLine[] }
  | { type: "graph",   nodes: { id, label, kind, needs: string[], card?: CardId }[] }
  | { type: "visual",  widget: Widget }
  | { type: "check",   items: Rich[] }
  | { type: "story",   events: { year?, text: Rich }[] }
  | { type: "units",   units: { id, title, milestone: Rich, lessonId?: LessonId }[] }  // study plan
  | { type: "recall",  questions: { q: Rich, options: Rich[], answer: number, why: Rich }[] }

Step      { id, move: Rich, formula?: Tex, why: Rich, whyNot?: Rich, uses: PartId[] }
ProofLine { id, claim: Rich, why: Rich, intuition?: Rich, whyNot?: Rich, deps: LineId[] }
```

**Rich text** is a small markup, the same as the prototype: `[part:label]`
links a part, `{card|label}` links a card, `$tex$` and `$$tex$$` are math, and
`**bold**` works. Inside TeX, `\p{part}{…}` marks a hoverable symbol. There is
no raw HTML. The renderer parses it with a fixed grammar. KaTeX runs with
`trust` limited to `\htmlData`.

**Drill-down and hierarchy come for free.** The child cards of a card are the
`{card}` links inside it. That is how the prototype's "where this sits" tree
works, so pi only writes links.

**Widgets** are a closed catalog, and each one has a schema:

| Widget | Covers |
|---|---|
| `plot` | functions with sliders. Expressions use a small safe parser, never `eval`. |
| `incline` / `freebody` | physics scenes: bodies, forces bound to parts, angle sliders |
| `flow` | business or data flows with animated edges |
| `dag` | concept graph, using the prototype's layered layout |
| `trace` | code + step slider + variable and memory state |
| `table` | group tables and truth tables, with hover links |
| `timeline`, `lattice`, `popcorn` | from the prototype |
| `scene` | generic SVG shapes, arrows and labels bound to params, for whatever has no widget yet |

The prototype's `audit.js` overlap checker runs in CI with Playwright on
every widget across its slider ranges.

**Stable reference IDs.** Every addressable item has an ID that is unique
within its version. A reference is `@<lessonSlug>/<sectionId>.<itemId>`, for
example `@thomae/c2.l5`. The `@ref` chips and anchored comments both use this.

**Size limit:** 512 KB per spec, uncompressed. The server checks the schema on
publish.

---

## 5. Database model (D1)

IDs are UUIDv7 text (sortable by time). Times are integer milliseconds. Status
fields are checked text, as in the template.

```sql
-- Better Auth tables: user, session, account, verification (drizzle sqlite schema)

profile (
  user_id     text primary key references user(id),
  handle      text not null unique,          -- learn.sirin.dev/@handle
  bio         text,
  lesson_count integer not null default 0
)

category (                                    -- curated, seeded, rarely changes
  id text primary key, parent_id text references category(id),
  slug text not null unique, name_en text not null, name_th text not null,
  sort integer not null
)
-- e.g. math › analysis › real-analysis, physics › mechanics, business › finance,
--      programming › data-structures

lesson (
  id            text primary key,
  owner_id      text not null references user(id),
  slug          text not null,                 -- unique per owner
  kind          text not null check (kind in ('solve','learn','situation','code','proof')),
  lang          text not null default 'en',
  title         text not null,
  summary       text not null,
  category_id   text references category(id),
  visibility    text not null default 'private'
                check (visibility in ('private','unlisted','public')),
  draft_key     text,                          -- R2 key of the editable draft, if any
  current_version_id text references lesson_version(id),
  forked_from_version_id text references lesson_version(id),
  problem_hash  text,                          -- sha256 of normalized problem text, for reuse
  like_count    integer not null default 0,
  fork_count    integer not null default 0,
  comment_count integer not null default 0,
  hot_score     real not null default 0,
  published_at  integer,                       -- first public publish
  created_at    integer not null,
  updated_at    integer not null,
  deleted_at    integer,
  unique (owner_id, slug)
)

lesson_version (                               -- immutable
  id          text primary key,
  lesson_id   text not null references lesson(id),
  n           integer not null,                -- 1, 2, 3 …
  body_hash   text not null,                   -- R2 key c/<hash>.json
  body_bytes  integer not null,
  schema      integer not null,
  note        text,
  created_at  integer not null,
  unique (lesson_id, n)
)

tag (
  id text primary key,
  slug text not null unique,                   -- normalized: lowercase, NFC, dashes
  name text not null,
  lesson_count integer not null default 0      -- public lessons only
)

lesson_tag (                                   -- at most 5 tags per lesson
  lesson_id    text not null references lesson(id),
  tag_id       text not null references tag(id),
  -- copies from lesson, so a tag feed is index only (kept in sync in the same batch)
  is_public    integer not null,
  published_at integer,
  hot_score    real not null default 0,
  primary key (lesson_id, tag_id)
)

lesson_like  (user_id text, lesson_id text, created_at integer, primary key (user_id, lesson_id))
bookmark     (user_id text, lesson_id text, created_at integer, primary key (user_id, lesson_id))

comment (
  id text primary key, lesson_id text not null, user_id text not null,
  version_id text not null,                    -- anchors belong to one version
  anchor text,                                 -- '@incline/s3' or null for the whole lesson
  parent_id text references comment(id),
  body text not null,                          -- plain text + the same Rich markup, ≤ 4 KB
  created_at integer not null, deleted_at integer
)

progress (                                     -- private learning state
  user_id text not null, lesson_id text not null, version_id text not null,
  state text not null,                         -- JSON ≤ 4 KB: step, revealed, quiz answers
  updated_at integer not null,
  primary key (user_id, lesson_id)
)

api_token (                                    -- for pi /publish
  id text primary key, user_id text not null,
  hash text not null unique,                   -- sha256 of the token, never the token
  name text not null, last_used_at integer, created_at integer not null, revoked_at integer
)

report (
  id text primary key, target_type text not null, target_id text not null,
  reporter_id text not null, reason text not null,
  status text not null default 'open', created_at integer not null
)

-- Search: FTS5, contentless, rebuilt from lesson + tags
create virtual table lesson_fts using fts5(
  title, summary, tags, problem, content='', tokenize='unicode61 remove_diacritics 2'
);
```

**Indexes, one for each feed.** SQLite supports partial indexes, so each feed
index holds only public rows:

```sql
create index lesson_new_idx  on lesson (published_at desc, id desc) where visibility = 'public' and deleted_at is null;
create index lesson_hot_idx  on lesson (hot_score desc, id desc)    where visibility = 'public' and deleted_at is null;
create index lesson_cat_idx  on lesson (category_id, published_at desc, id desc) where visibility = 'public' and deleted_at is null;
create index lesson_kind_idx on lesson (kind, published_at desc, id desc)        where visibility = 'public' and deleted_at is null;
create index lesson_owner_idx on lesson (owner_id, updated_at desc, id desc);
create index lesson_problem_idx on lesson (problem_hash) where problem_hash is not null;
create index lesson_tag_feed_idx on lesson_tag (tag_id, published_at desc, lesson_id) where is_public = 1;
create index lesson_tag_hot_idx  on lesson_tag (tag_id, hot_score desc, lesson_id)    where is_public = 1;
create index comment_lesson_idx on comment (lesson_id, created_at, id);
```

A feed page of 20 reads about 20 index rows plus 20 lesson rows.

**Categories vs tags vs kind**

| Field | What it is | Who sets it | Count |
|---|---|---|---|
| category | where the lesson lives, a curated tree | the author picks one, required for public | 1 |
| tags | free labels, such as `galois`, `epsilon-delta`, `friction` | the author, with autocomplete from existing tags | 1–5 |
| kind | the shape of the lesson (solve, learn, …) | pi | 1 |
| lang | en / th | pi | 1 |

Explore filters combine them: category (with sub-categories) × kind × lang ×
one tag. Category pages use `lesson_cat_idx`. Tag pages use `lesson_tag_*`.
To filter by a category *and* its children, the client sends the list of
category IDs (the tree ships as static JSON), and the query uses `category_id in (...)`.

**Counters** change in the same `db.batch()` as the row they count (a D1 batch
is one transaction). For example, a like inserts `lesson_like` and runs
`update lesson set like_count = like_count + 1`, and also updates `lesson_tag`
for hot score later.

**Hot score:** a cron every 30 minutes recomputes
`(likes + 2·forks + comments + 1) / (age_hours + 2)^1.5` for lessons published
in the last 14 days. Older scores stay frozen. It writes only the rows that changed.

**Thai search:** FTS5 `unicode61` doesn't split Thai words. On write, split
Thai text with `Intl.Segmenter('th', {granularity:'word'})` and store it with
spaces in the FTS columns. Do the same to the query. (Check at build time that
workerd ships Thai ICU data.)

**Backups:** D1 Time Travel (point-in-time restore) is the main backup. D1
can't export a database that has virtual tables. So the offsite weekly export
drops and rebuilds `lesson_fts` around the export, or the FTS table moves to a
second D1 database (decide at build time). Lesson bodies in R2 are immutable,
so they are their own backup.

---

## 6. Main flows

**Publish from pi**
1. pi's `learn` skill writes `lesson.json` in the topic folder and validates it against the JSON Schema.
2. `/publish` sends `POST /api/lessons/:slug/versions` with a bearer API token.
3. The Worker checks the schema and the size, hashes the body, and runs `PUT c/<hash>.json` on R2 (skipped if it exists).
4. A D1 batch inserts `lesson_version`, updates `lesson.current_version_id`, updates tags and counters, and upserts `lesson_fts`.
5. New lessons start **private**. Making one public needs a category and at least 1 tag.

**Read a public lesson**
`GET /api/lessons/@handle/slug` returns metadata (cached 60 s at the edge for
anonymous readers). Then `GET /c/<hash>.json` returns the body (immutable,
edge cached). The client renders it. Progress loads only if the reader is signed in.

**Fork:** this copies one row. The new lesson points at the same `body_hash`,
so R2 stores nothing new until the forker edits it.

**Ask about a chunk (`@ref`):** in phase 1 the web app copies a ready prompt
(question + referenced chunks as clean TeX) to paste into pi. Phase 2 sends it
to the learner's own key in the browser, and the answer can be saved as a new
card in their fork.

**Comments** can attach to any `@ref`. The reader shows a small count next to
that step or proof line.

**Moderation:** report button, author can hide comments, admin list of open
reports. Rate limits on publish, comment and like use the Workers Rate
Limiting binding, keyed by user.

---

## 7. Stack: template vs this project

Keep: Bun workspaces, TypeScript strict, Effect 4.0.x, `HttpApi` +
`HttpApiClient`, Effect Schema, React + Vite, TanStack Router / Query /
Virtual, Base UI + Tailwind v4, i18n (EN + TH), Better Auth, Biome, Vitest +
`@effect/vitest`, Playwright, the Storage seam (R2), keyset pagination, OTLP
tracing (optional).

Change (each one gets an ADR):

| Template | Here | Note |
|---|---|---|
| Postgres + Hyperdrive + `@effect/sql-pg` | **D1** + `@effect/sql-d1` 4.0.1 (peers `effect ^4.0.1`) | Drizzle `sqlite-core` defines tables and builds typed SQL. Effect runs it, the same pattern as the template. |
| RLS + org tenancy | **No orgs.** Rules live in `packages/services` (owner checks, visibility). | A repository function for private data requires `CurrentUser` in its type. |
| Alchemy | **wrangler** (`wrangler.jsonc`) + `@cloudflare/vite-plugin` | `bun run dev` runs the Worker inside Vite. `wrangler d1 migrations apply` runs as its own step before `wrangler deploy`. |
| Queue + Postgres job table | none in v1 | add Queues or Workflows with hosted generation |
| Docker / Bun / on-prem entry | dropped | Cloudflare only |
| Better Auth org + SSO plugins, email + password | dropped. Google + GitHub social, API-key tokens of our own. | `drizzleAdapter(db, { provider: "sqlite" })` |
| Resend | none | no emails in v1 |

**Repository layout**

```
apps/web            React SPA (reader, library, explore, profile)
apps/worker         Worker entry: HttpApi, auth, cache, cron; wrangler.jsonc
packages/domain     Ids, errors, LessonSpec schema (the pi contract), Rich parser
packages/api        HttpApi definitions
packages/db         Drizzle sqlite schema, migrations, D1 Layer
packages/auth       Better Auth config
packages/services   lessons, feeds, tags, likes, comments, progress, publish
packages/ui         Linear tokens, Base UI wrappers, i18n
packages/lesson     renderer + widget catalog + Rich/TeX + audit (used by web; can run offline for pi)
tools/pi            learn skill + /publish extension + JSON Schema export
```

**wrangler.jsonc (sketch)**

```jsonc
{
  "name": "learn",
  "main": "src/worker.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "routes": [{ "pattern": "learn.sirin.dev", "custom_domain": true }],
  "assets": { "directory": "../web/dist", "not_found_handling": "single-page-application",
              "run_worker_first": ["/api/*", "/c/*"] },
  "d1_databases": [{ "binding": "DB", "database_name": "learn",
                     "database_id": "<from wrangler d1 create>", "migrations_dir": "../../packages/db/migrations" }],
  "r2_buckets": [{ "binding": "CONTENT", "bucket_name": "learn-content" }],
  "ratelimits": [{ "name": "WRITE_LIMIT", "namespace_id": "1001", "simple": { "limit": 30, "period": 60 } }],
  "triggers": { "crons": ["*/30 * * * *"] },
  "observability": { "enabled": true }
}
// secrets: wrangler secret put BETTER_AUTH_SECRET / GOOGLE_CLIENT_SECRET / GITHUB_CLIENT_SECRET
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
   "hello" to learn.sirin.dev with D1 + R2 bound. Sign in with GitHub.
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

- drizzle-kit migration file layout vs what `wrangler d1 migrations apply`
  expects. If they don't match, write SQL migrations by hand and use Drizzle only for types.
- Better Auth on D1: drizzle sqlite adapter (planned) vs passing the D1
  binding directly. Check on 1.7.x.
- Does `Intl.Segmenter` with Thai work in workerd?
- Should FTS live in a second D1 database to keep exports simple?
- Are unlisted lessons enough for "share with a friend", or do we need invite links?
- License for shared lessons (suggest CC BY-SA, with forks credited).
