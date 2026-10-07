import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
import { user } from "./auth-schema.ts"

// The D1 model (docs/design.md §5). Lesson and concept bodies live in R2 as immutable
// `c/<sha256>.json`; D1 keeps metadata, counters and the search index. D1 bills rows scanned, so
// every list query has an index that covers it, and feed indexes are partial (public rows only).

// Only the columns other packages may read. Session and OAuth data stay in auth-schema.ts. Email is
// here for `GET /api/me` only; never put it in a public response.
export const publicUser = {
  table: user,
  id: user.id,
  name: user.name,
  email: user.email,
  image: user.image,
}

const id = () => text("id").primaryKey()
const ms = (name: string) => integer(name)
const live = sql`visibility = 'public' and deleted_at is null`

export const profile = sqliteTable("profile", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  handle: text("handle").notNull().unique(),
  bio: text("bio"),
  lessonCount: integer("lesson_count").notNull().default(0),
})

export const category = sqliteTable("category", {
  id: id(),
  parentId: text("parent_id"),
  slug: text("slug").notNull().unique(),
  nameEn: text("name_en").notNull(),
  nameTh: text("name_th").notNull(),
  sort: integer("sort").notNull(),
})

export const lesson = sqliteTable(
  "lesson",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id),
    slug: text("slug").notNull(),
    kind: text("kind", { enum: ["solve", "learn", "situation", "code", "proof", "guide"] }).notNull(),
    // The language it was first published in; title and summary are copied from that version.
    lang: text("lang", { enum: ["en", "th"] }).notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    categoryId: text("category_id").references(() => category.id),
    visibility: text("visibility", { enum: ["private", "unlisted", "public"] })
      .notNull()
      .default("private"),
    forkedFromVersionId: text("forked_from_version_id"),
    problemHash: text("problem_hash"),
    likeCount: integer("like_count").notNull().default(0),
    forkCount: integer("fork_count").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),
    hotScore: real("hot_score").notNull().default(0),
    publishedAt: ms("published_at"),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
    deletedAt: ms("deleted_at"),
  },
  (t) => [
    uniqueIndex("lesson_owner_slug_uq").on(t.ownerId, t.slug),
    check("lesson_kind_ck", sql`${t.kind} in ('solve','learn','situation','code','proof','guide')`),
    check("lesson_visibility_ck", sql`${t.visibility} in ('private','unlisted','public')`),
    check("lesson_lang_ck", sql`${t.lang} in ('en','th')`),
    index("lesson_new_idx").on(sql`published_at desc`, sql`id desc`).where(live),
    index("lesson_hot_idx").on(sql`hot_score desc`, sql`id desc`).where(live),
    index("lesson_cat_idx").on(t.categoryId, sql`published_at desc`, sql`id desc`).where(live),
    index("lesson_kind_idx").on(t.kind, sql`published_at desc`, sql`id desc`).where(live),
    index("lesson_owner_idx").on(t.ownerId, sql`updated_at desc`, sql`id desc`),
    index("lesson_problem_idx").on(t.problemHash).where(sql`problem_hash is not null`),
  ],
)

// Immutable. One row per published version of one language.
export const lessonVersion = sqliteTable(
  "lesson_version",
  {
    id: id(),
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lesson.id),
    lang: text("lang", { enum: ["en", "th"] }).notNull(),
    n: integer("n").notNull(),
    bodyHash: text("body_hash").notNull(),
    bodyBytes: integer("body_bytes").notNull(),
    schema: integer("schema").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    note: text("note"),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("lesson_version_n_uq").on(t.lessonId, t.lang, t.n),
    index("lesson_version_hash_idx").on(t.bodyHash),
  ],
)

// The current version of each language of a lesson.
export const lessonLang = sqliteTable(
  "lesson_lang",
  {
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lesson.id),
    lang: text("lang", { enum: ["en", "th"] }).notNull(),
    versionId: text("version_id")
      .notNull()
      .references(() => lessonVersion.id),
  },
  (t) => [primaryKey({ columns: [t.lessonId, t.lang] })],
)

export const tag = sqliteTable("tag", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  // Public lessons only.
  lessonCount: integer("lesson_count").notNull().default(0),
})

// Copies is_public / published_at / hot_score from lesson, so a tag feed reads only this index.
export const lessonTag = sqliteTable(
  "lesson_tag",
  {
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lesson.id),
    tagId: text("tag_id")
      .notNull()
      .references(() => tag.id),
    isPublic: integer("is_public").notNull(),
    publishedAt: ms("published_at"),
    hotScore: real("hot_score").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.lessonId, t.tagId] }),
    index("lesson_tag_feed_idx").on(t.tagId, sql`published_at desc`, t.lessonId).where(sql`is_public = 1`),
    index("lesson_tag_hot_idx").on(t.tagId, sql`hot_score desc`, t.lessonId).where(sql`is_public = 1`),
  ],
)

export const lessonLike = sqliteTable(
  "lesson_like",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lesson.id),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.lessonId] })],
)

export const bookmark = sqliteTable(
  "bookmark",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lesson.id),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.lessonId] })],
)

export const comment = sqliteTable(
  "comment",
  {
    id: id(),
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lesson.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    // Anchors belong to one version.
    versionId: text("version_id")
      .notNull()
      .references(() => lessonVersion.id),
    anchor: text("anchor"),
    parentId: text("parent_id"),
    body: text("body").notNull(),
    createdAt: ms("created_at").notNull(),
    deletedAt: ms("deleted_at"),
  },
  (t) => [index("comment_lesson_idx").on(t.lessonId, t.createdAt, t.id)],
)

export const progress = sqliteTable(
  "progress",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lesson.id),
    versionId: text("version_id").notNull(),
    // JSON ≤ 4 KB: step, revealed, quiz answers.
    state: text("state").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.lessonId] })],
)

// For pi `/publish`. Only the sha256 of the token is stored.
export const apiToken = sqliteTable(
  "api_token",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    hash: text("hash").notNull().unique(),
    name: text("name").notNull(),
    lastUsedAt: ms("last_used_at"),
    createdAt: ms("created_at").notNull(),
    revokedAt: ms("revoked_at"),
  },
  (t) => [index("api_token_user_idx").on(t.userId, t.createdAt)],
)

export const report = sqliteTable("report", {
  id: id(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  reporterId: text("reporter_id")
    .notNull()
    .references(() => user.id),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"),
  createdAt: ms("created_at").notNull(),
})

// ── Shared concepts. Written once, reused by many lessons. A lesson pins the concept versions it
// uses (and their prerequisites) when it publishes, so a later edit never changes an old lesson.
export const concept = sqliteTable("concept", {
  id: id(),
  slug: text("slug").notNull().unique(),
  kind: text("kind").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),
  // Lessons whose current version uses it (updated on publish).
  useCount: integer("use_count").notNull().default(0),
  createdAt: ms("created_at").notNull(),
  updatedAt: ms("updated_at").notNull(),
})

export const conceptVersion = sqliteTable(
  "concept_version",
  {
    id: id(),
    conceptId: text("concept_id")
      .notNull()
      .references(() => concept.id),
    lang: text("lang", { enum: ["en", "th"] }).notNull(),
    n: integer("n").notNull(),
    bodyHash: text("body_hash").notNull(),
    bodyBytes: integer("body_bytes").notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("concept_version_n_uq").on(t.conceptId, t.lang, t.n),
    index("concept_version_hash_idx").on(t.bodyHash),
  ],
)

export const conceptLang = sqliteTable(
  "concept_lang",
  {
    conceptId: text("concept_id")
      .notNull()
      .references(() => concept.id),
    lang: text("lang", { enum: ["en", "th"] }).notNull(),
    versionId: text("version_id")
      .notNull()
      .references(() => conceptVersion.id),
    title: text("title").notNull(),
    // JSON array of strings.
    aliases: text("aliases").notNull(),
  },
  (t) => [primaryKey({ columns: [t.conceptId, t.lang] })],
)

// The current prerequisite graph (the same in every language).
export const conceptNeed = sqliteTable(
  "concept_need",
  {
    conceptId: text("concept_id")
      .notNull()
      .references(() => concept.id),
    needId: text("need_id")
      .notNull()
      .references(() => concept.id),
  },
  (t) => [primaryKey({ columns: [t.conceptId, t.needId] })],
)

// The concept versions a lesson version uses. `card_id` is the lesson's local card id, or null for
// a prerequisite pulled in through `needs`.
export const lessonVersionConcept = sqliteTable(
  "lesson_version_concept",
  {
    lessonVersionId: text("lesson_version_id")
      .notNull()
      .references(() => lessonVersion.id),
    conceptVersionId: text("concept_version_id")
      .notNull()
      .references(() => conceptVersion.id),
    cardId: text("card_id"),
  },
  (t) => [primaryKey({ columns: [t.lessonVersionId, t.conceptVersionId] })],
)
