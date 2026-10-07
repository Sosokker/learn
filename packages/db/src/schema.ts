import { sql } from "drizzle-orm"
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core"
import { authUser } from "./auth-schema.ts"

// App tables on D1 (SQLite). Ids are UUIDv7 text (sortable by time), times are integer epoch
// milliseconds, status fields are checked text. Lesson and concept bodies are not here: they are
// immutable JSON files in R2 named by their sha256 (`c/<hash>.json`); rows keep only the hash.
//
// D1 bills rows scanned, so every list query has an index that covers it, and the public feeds
// use partial indexes that hold public rows only. Index columns are ascending: SQLite walks an
// index backwards for `order by published_at desc, id desc`, so a desc index buys nothing. Counters live on the row and change in the same
// D1 batch (one transaction) as the rows they count.
//
// FTS5 tables (`concept_fts`) cannot be declared in Drizzle; they live in a hand-written
// migration (see migrations/). The category seed is a migration too.

const visibilities = sql`('private', 'unlisted', 'public')`
const langs = sql`('en', 'th')`

export const profile = sqliteTable("profile", {
  user_id: text()
    .primaryKey()
    .references(() => authUser.id, { onDelete: "cascade" }),
  // learn.sirin.dev/@handle. Lowercase; from the Latin letters of the Google name (or user_<random>)
  // on first sign-in, changeable through PATCH /api/me.
  handle: text().notNull().unique(),
  bio: text(),
  // Public lessons only; recomputed in the batch that changes a lesson's visibility.
  lesson_count: integer().notNull().default(0),
  created_at: integer().notNull(),
})

// Curated tree, seeded by migration. The id is the dotted path (`physics.mechanics`), so it is
// also the URL slug, and "this category and its children" is `id = ? or id like ? || '.%'`.
export const category = sqliteTable(
  "category",
  {
    id: text().primaryKey(),
    parent_id: text().references((): AnySQLiteColumn => category.id),
    name_en: text().notNull(),
    name_th: text().notNull(),
    sort: integer().notNull(),
  },
  (table) => [index("category_parent_idx").on(table.parent_id, table.sort)],
)

export const lesson = sqliteTable(
  "lesson",
  {
    id: text().primaryKey(),
    owner_id: text()
      .notNull()
      .references(() => authUser.id),
    // Unique per owner: learn.sirin.dev/@handle/slug.
    slug: text().notNull(),
    kind: text().notNull(),
    // The language whose title and summary the feeds show: the first one published.
    default_lang: text().notNull(),
    title: text().notNull(),
    summary: text().notNull(),
    category_id: text().references(() => category.id),
    visibility: text().notNull().default("private"),
    forked_from_version_id: text().references((): AnySQLiteColumn => lessonVersion.id),
    // sha256 of the normalized problem text, for "this was already solved" reuse.
    problem_hash: text(),
    like_count: integer().notNull().default(0),
    fork_count: integer().notNull().default(0),
    comment_count: integer().notNull().default(0),
    hot_score: real().notNull().default(0),
    // The first time the lesson became public; feeds sort by it.
    published_at: integer(),
    created_at: integer().notNull(),
    updated_at: integer().notNull(),
    deleted_at: integer(),
  },
  (table) => [
    unique("lesson_owner_slug_unique").on(table.owner_id, table.slug),
    check(
      "lesson_kind_check",
      sql`${table.kind} in ('solve', 'learn', 'situation', 'code', 'proof', 'guide')`,
    ),
    check("lesson_default_lang_check", sql`${table.default_lang} in ${langs}`),
    check("lesson_visibility_check", sql`${table.visibility} in ${visibilities}`),
    // One index per feed, holding public rows only.
    index("lesson_new_idx")
      .on(table.published_at, table.id)
      .where(sql`visibility = 'public' and deleted_at is null`),
    index("lesson_hot_idx")
      .on(table.hot_score, table.id)
      .where(sql`visibility = 'public' and deleted_at is null`),
    index("lesson_cat_idx")
      .on(table.category_id, table.published_at, table.id)
      .where(sql`visibility = 'public' and deleted_at is null`),
    index("lesson_kind_idx")
      .on(table.kind, table.published_at, table.id)
      .where(sql`visibility = 'public' and deleted_at is null`),
    index("lesson_owner_idx").on(table.owner_id, table.updated_at, table.id),
    index("lesson_problem_idx").on(table.problem_hash).where(sql`problem_hash is not null`),
  ],
)

// Immutable. Numbered per language: en v1, en v2, th v1 …
export const lessonVersion = sqliteTable(
  "lesson_version",
  {
    id: text().primaryKey(),
    lesson_id: text()
      .notNull()
      .references(() => lesson.id),
    lang: text().notNull(),
    n: integer().notNull(),
    // R2 key c/<body_hash>.json
    body_hash: text().notNull(),
    body_bytes: integer().notNull(),
    schema: integer().notNull(),
    note: text(),
    created_at: integer().notNull(),
  },
  (table) => [
    unique("lesson_version_lesson_lang_n_unique").on(table.lesson_id, table.lang, table.n),
    check("lesson_version_lang_check", sql`${table.lang} in ${langs}`),
    // `/c/<hash>.json` checks that a hash belongs to a readable version before serving it.
    index("lesson_version_hash_idx").on(table.body_hash),
  ],
)

// The current version of each language of a lesson (replaces lesson.current_version_id).
export const lessonLang = sqliteTable(
  "lesson_lang",
  {
    lesson_id: text()
      .notNull()
      .references(() => lesson.id),
    lang: text().notNull(),
    version_id: text()
      .notNull()
      .references(() => lessonVersion.id),
    title: text().notNull(),
    summary: text().notNull(),
    updated_at: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.lesson_id, table.lang] }),
    check("lesson_lang_lang_check", sql`${table.lang} in ${langs}`),
  ],
)

export const tag = sqliteTable("tag", {
  id: text().primaryKey(),
  // Normalized: NFC, lowercase, words joined with dashes.
  slug: text().notNull().unique(),
  name: text().notNull(),
  // Public lessons only.
  lesson_count: integer().notNull().default(0),
})

// At most 5 per lesson. is_public, published_at and hot_score are copies from lesson, kept in
// sync in the same batch, so a tag feed reads this index only.
export const lessonTag = sqliteTable(
  "lesson_tag",
  {
    lesson_id: text()
      .notNull()
      .references(() => lesson.id),
    tag_id: text()
      .notNull()
      .references(() => tag.id),
    is_public: integer().notNull().default(0),
    published_at: integer(),
    hot_score: real().notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.lesson_id, table.tag_id] }),
    index("lesson_tag_feed_idx")
      .on(table.tag_id, table.published_at, table.lesson_id)
      .where(sql`is_public = 1`),
    index("lesson_tag_hot_idx").on(table.tag_id, table.hot_score, table.lesson_id).where(sql`is_public = 1`),
  ],
)

export const lessonLike = sqliteTable(
  "lesson_like",
  {
    user_id: text()
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    lesson_id: text()
      .notNull()
      .references(() => lesson.id),
    created_at: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.user_id, table.lesson_id] })],
)

export const bookmark = sqliteTable(
  "bookmark",
  {
    user_id: text()
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    lesson_id: text()
      .notNull()
      .references(() => lesson.id),
    created_at: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.user_id, table.lesson_id] })],
)

export const comment = sqliteTable(
  "comment",
  {
    id: text().primaryKey(),
    lesson_id: text()
      .notNull()
      .references(() => lesson.id),
    user_id: text()
      .notNull()
      .references(() => authUser.id),
    // Anchors belong to one version.
    version_id: text()
      .notNull()
      .references(() => lessonVersion.id),
    // `@slug/section.item`, or null for the whole lesson.
    anchor: text(),
    parent_id: text().references((): AnySQLiteColumn => comment.id),
    body: text().notNull(),
    created_at: integer().notNull(),
    deleted_at: integer(),
  },
  (table) => [index("comment_lesson_idx").on(table.lesson_id, table.created_at, table.id)],
)

// Private learning state (step, revealed cards, quiz answers), JSON ≤ 4 KB.
export const progress = sqliteTable(
  "progress",
  {
    user_id: text()
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    lesson_id: text()
      .notNull()
      .references(() => lesson.id),
    version_id: text()
      .notNull()
      .references(() => lessonVersion.id),
    state: text().notNull(),
    updated_at: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.user_id, table.lesson_id] })],
)

// Bearer tokens for pi's /publish. Only the sha256 of a token is stored, never the token.
export const apiToken = sqliteTable(
  "api_token",
  {
    id: text().primaryKey(),
    user_id: text()
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    hash: text().notNull().unique(),
    name: text().notNull(),
    last_used_at: integer(),
    created_at: integer().notNull(),
    revoked_at: integer(),
  },
  (table) => [index("api_token_user_idx").on(table.user_id, table.created_at)],
)

export const report = sqliteTable(
  "report",
  {
    id: text().primaryKey(),
    target_type: text().notNull(),
    target_id: text().notNull(),
    reporter_id: text()
      .notNull()
      .references(() => authUser.id),
    reason: text().notNull(),
    status: text().notNull().default("open"),
    created_at: integer().notNull(),
  },
  (table) => [
    check("report_status_check", sql`${table.status} in ('open', 'resolved', 'dismissed')`),
    index("report_open_idx").on(table.created_at).where(sql`status = 'open'`),
  ],
)

// ── Shared concepts. Written once (`physics.newton-second-law`), reused by many lessons. Anyone
// signed in may create one; only its owner adds versions. Bodies are public, in R2 like lessons.
export const concept = sqliteTable("concept", {
  id: text().primaryKey(),
  slug: text().notNull().unique(),
  owner_id: text()
    .notNull()
    .references(() => authUser.id),
  created_at: integer().notNull(),
  updated_at: integer().notNull(),
})

// Immutable, numbered per language like lesson versions. `slug@2` in a lesson pins n = 2 of the
// lesson's language.
export const conceptVersion = sqliteTable(
  "concept_version",
  {
    id: text().primaryKey(),
    concept_id: text()
      .notNull()
      .references(() => concept.id),
    lang: text().notNull(),
    n: integer().notNull(),
    body_hash: text().notNull(),
    body_bytes: integer().notNull(),
    created_at: integer().notNull(),
  },
  (table) => [
    unique("concept_version_concept_lang_n_unique").on(table.concept_id, table.lang, table.n),
    check("concept_version_lang_check", sql`${table.lang} in ${langs}`),
    index("concept_version_hash_idx").on(table.body_hash),
  ],
)

// Current version per language, plus what search shows and indexes. `search` is the text given to
// concept_fts (Thai already split into words), kept here so the FTS table can be rebuilt with one
// statement (see packages/db/README.md: exports drop the virtual table first).
export const conceptLang = sqliteTable(
  "concept_lang",
  {
    concept_id: text()
      .notNull()
      .references(() => concept.id),
    lang: text().notNull(),
    version_id: text()
      .notNull()
      .references(() => conceptVersion.id),
    kind: text().notNull(),
    title: text().notNull(),
    // JSON array of strings.
    aliases: text().notNull(),
    search: text().notNull(),
    updated_at: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.concept_id, table.lang] }),
    check("concept_lang_lang_check", sql`${table.lang} in ${langs}`),
  ],
)

// Prerequisites (the global concept graph): edges of the current versions. Acyclic; the service
// checks before it writes.
export const conceptNeed = sqliteTable(
  "concept_need",
  {
    concept_id: text()
      .notNull()
      .references(() => concept.id),
    need_id: text()
      .notNull()
      .references(() => concept.id),
  },
  (table) => [
    primaryKey({ columns: [table.concept_id, table.need_id] }),
    index("concept_need_need_idx").on(table.need_id),
  ],
)

// Which concept version each `{ concept }` card of a lesson version resolved to at publish time.
// Later concept versions never change an existing lesson version.
export const lessonVersionConcept = sqliteTable(
  "lesson_version_concept",
  {
    lesson_version_id: text()
      .notNull()
      .references(() => lessonVersion.id),
    card_id: text().notNull(),
    concept_version_id: text()
      .notNull()
      .references(() => conceptVersion.id),
  },
  (table) => [
    primaryKey({ columns: [table.lesson_version_id, table.card_id] }),
    // "How many lessons use this concept" and reverse lookups.
    index("lesson_version_concept_concept_idx").on(table.concept_version_id),
  ],
)
