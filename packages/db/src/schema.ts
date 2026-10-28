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
  uniqueIndex,
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
// FTS5 tables (`concept_fts`, `lesson_fts`) cannot be declared in Drizzle; they live in a hand-written
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
    index("lesson_kind_idx")
      .on(table.kind, table.published_at, table.id)
      .where(sql`visibility = 'public' and deleted_at is null`),
    index("lesson_kind_hot_idx")
      .on(table.kind, table.hot_score, table.id)
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

// The current version of each language of a lesson (replaces lesson.current_version_id), plus
// what lesson search indexes and the per-language feed.
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
    // The text given to lesson_fts: title and summary, Thai split into words (like
    // concept_lang.search). Null only for rows from before migration 0007; the cron fills those.
    search: text(),
    // The rowid of this row's lesson_fts row, fixed when the row is created (see concept_lang).
    // lesson_fts holds a row only while the lesson is public.
    fts_rowid: integer(),
    // Copies from lesson, kept in sync in the same batch (like lesson_tag), so the feed of one
    // language reads this index only.
    is_public: integer().notNull().default(0),
    published_at: integer(),
    updated_at: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.lesson_id, table.lang] }),
    check("lesson_lang_lang_check", sql`${table.lang} in ${langs}`),
    uniqueIndex("lesson_lang_fts_rowid_unique").on(table.fts_rowid),
    index("lesson_lang_feed_idx")
      .on(table.lang, table.published_at, table.lesson_id)
      .where(sql`is_public = 1`),
    // The cron's search backfill reads only the rows still waiting.
    index("lesson_lang_search_todo_idx").on(table.lesson_id).where(sql`search is null`),
  ],
)

export const tag = sqliteTable("tag", {
  id: text().primaryKey(),
  // Normalized: NFC, lowercase, words joined with dashes.
  slug: text().notNull().unique(),
  name: text().notNull(),
  // Public lessons only. Changed by ±1 in the batch that changes a lesson's tags or visibility
  // (see Lessons.update), never recounted.
  lesson_count: integer().notNull().default(0),
})

// The category feeds: one row per public lesson for its category and every ancestor of it
// (`math.analysis.real-analysis` also lists under `math.analysis` and `math`), with a copy of
// published_at. So the feed of any category, parent or leaf, is one range of this index in
// feed order, and no sort. Rows exist only while the lesson is public; the batch that changes a
// lesson's category or visibility deletes and rewrites them.
export const lessonCategory = sqliteTable(
  "lesson_category",
  {
    lesson_id: text()
      .notNull()
      .references(() => lesson.id),
    category_id: text()
      .notNull()
      .references(() => category.id),
    published_at: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.lesson_id, table.category_id] }),
    index("lesson_category_feed_idx").on(table.category_id, table.published_at, table.lesson_id),
  ],
)

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
    // The hot-score cron rewrites only rows published in its window: a range of this index.
    index("lesson_tag_recent_idx").on(table.published_at).where(sql`is_public = 1`),
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
  (table) => [
    // The PK answers "did I like it"; this one the lesson delete, which removes its likes.
    primaryKey({ columns: [table.user_id, table.lesson_id] }),
    index("lesson_like_lesson_idx").on(table.lesson_id),
  ],
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
  (table) => [
    primaryKey({ columns: [table.user_id, table.lesson_id] }),
    // "My bookmarks", newest first (keyset), and the lesson delete.
    index("bookmark_user_idx").on(table.user_id, table.created_at, table.lesson_id),
    index("bookmark_lesson_idx").on(table.lesson_id),
  ],
)

// Comments on a lesson, anchored to one piece of it (design §6.11). Ids of parts,
// cards, sections and items are the same in every language and stay across versions, so a
// comment belongs to the lesson and survives new versions; the reader says when its anchor is
// gone. One level of replies: a reply's parent is a top-level comment, and it has its anchor.
//
// `lesson.comment_count` counts the comments everyone sees (not deleted, not hidden); it moves
// by ±1 in the batch that creates, deletes, hides or unhides one. `reply_count` counts every reply
// ever written (deleted ones too); it only caps a thread's size.
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
    // The version the author was reading (its language is the comment's language).
    version_id: text()
      .notNull()
      .references(() => lessonVersion.id),
    // `lesson` (the whole lesson), `part:<id>`, `card:<id>`, `section:<id>` or
    // `item:<section>.<item>` (the renderer's target keys). Never null since migration 0010.
    anchor: text(),
    parent_id: text().references((): AnySQLiteColumn => comment.id),
    // Plain text, never markup (ADR 0004). Emptied when the comment is deleted.
    body: text().notNull(),
    reply_count: integer().notNull().default(0),
    created_at: integer().notNull(),
    edited_at: integer(),
    deleted_at: integer(),
    // Hidden by a moderator: `owner` (the lesson's owner) or `admin`. Only the author, the lesson
    // owner and admins still see it.
    hidden_at: integer(),
    hidden_by: text(),
  },
  (table) => [
    // A lesson's threads, newest first, and the threads of one anchor.
    index("comment_thread_idx").on(table.lesson_id, table.created_at, table.id).where(sql`parent_id is null`),
    index("comment_anchor_idx")
      .on(table.lesson_id, table.anchor, table.created_at, table.id)
      .where(sql`parent_id is null`),
    // The replies of a page of threads.
    index("comment_reply_idx")
      .on(table.parent_id, table.created_at, table.id)
      .where(sql`parent_id is not null`),
  ],
)

// Private reading progress, one row per user and lesson (section ids are the same in every
// language, so it carries over). `state` is JSON written by Progress.save: the sections seen, the
// last one, how many the version has, and its language. `done` is 1 once every section was seen;
// "Continue learning" lists the unfinished rows only.
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
    done: integer().notNull().default(0),
    updated_at: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.user_id, table.lesson_id] }),
    index("progress_user_idx").on(table.user_id, table.updated_at, table.lesson_id).where(sql`done = 0`),
    index("progress_lesson_idx").on(table.lesson_id),
  ],
)

// Bearer tokens for pi's /publish (ADR 0008). Only the sha256 of a token is stored, never the
// token. `prefix` is its first characters, not secret, so the settings page can tell tokens apart.
export const apiToken = sqliteTable(
  "api_token",
  {
    id: text().primaryKey(),
    user_id: text()
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    hash: text().notNull().unique(),
    name: text().notNull(),
    prefix: text().notNull().default(""),
    last_used_at: integer(),
    created_at: integer().notNull(),
    revoked_at: integer(),
  },
  (table) => [
    // The user-delete cascade.
    index("api_token_user_idx").on(table.user_id, table.created_at),
    // The settings list and the per-user cap read active tokens only, so revoked rows cost nothing.
    index("api_token_active_idx")
      .on(table.user_id, table.created_at, table.id)
      .where(sql`revoked_at is null`),
  ],
)

// A signed-in user's report of a lesson or a comment. Nobody but admins lists them. One open
// report per user and target (the partial unique index); resolving closes every open report of
// the target at once.
export const report = sqliteTable(
  "report",
  {
    id: text().primaryKey(),
    // `lesson` or `comment` (checked by the API schema; the table predates it).
    target_type: text().notNull(),
    target_id: text().notNull(),
    reporter_id: text()
      .notNull()
      .references(() => authUser.id),
    // spam | abuse | wrong | other (the API schema checks it).
    reason: text().notNull(),
    // Optional short text from the reporter, plain text.
    note: text(),
    status: text().notNull().default("open"),
    created_at: integer().notNull(),
    resolved_at: integer(),
    resolved_by: text(),
  },
  (table) => [
    check("report_status_check", sql`${table.status} in ('open', 'resolved', 'dismissed')`),
    // The admin queue, newest first (keyset).
    index("report_queue_idx").on(table.created_at, table.id).where(sql`status = 'open'`),
    uniqueIndex("report_open_unique")
      .on(table.reporter_id, table.target_type, table.target_id)
      .where(sql`status = 'open'`),
    // Resolving a target closes its open reports.
    index("report_target_idx").on(table.target_type, table.target_id).where(sql`status = 'open'`),
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
    // The rowid of this row's concept_fts row, fixed when the row is created. concept_fts's other
    // columns are UNINDEXED, so finding its row by concept_id would scan the whole FTS table.
    // Null only before migration 0005 backfilled it.
    fts_rowid: integer(),
    updated_at: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.concept_id, table.lang] }),
    check("concept_lang_lang_check", sql`${table.lang} in ${langs}`),
    uniqueIndex("concept_lang_fts_rowid_unique").on(table.fts_rowid),
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
