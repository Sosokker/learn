import { ConceptSlug, ConceptSpec, LessonKind, LessonLang } from "@app/domain"
import { Schema } from "effect"

// Ids, wire models and the request/response shapes shared by the Worker (handlers, services) and
// the web client. They live here rather than in packages/domain, whose index is owned by the
// LessonSpec work; they can move there once it exports them.

// Better Auth user ids (UUIDv7 here, but the platform user from seed:local is a fixed string).
export const UserId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)).pipe(
  Schema.brand("UserId"),
)
export type UserId = typeof UserId.Type

const Uuid = Schema.String.check(Schema.isUUID())
export const LessonId = Uuid.pipe(Schema.brand("LessonId"))
export type LessonId = typeof LessonId.Type
export const LessonVersionId = Uuid.pipe(Schema.brand("LessonVersionId"))
export type LessonVersionId = typeof LessonVersionId.Type
export const ConceptVersionId = Uuid.pipe(Schema.brand("ConceptVersionId"))
export type ConceptVersionId = typeof ConceptVersionId.Type

// The platform account (seed:local / seed:remote): owns the guide and the shared content concepts.
// It never signs in. Only it may publish under the reserved `platform.*` names.
export const platformUserId = UserId.make("learn")
export const platformHandle = "learn"
export const platformPrefix = "platform"

// learn.sirin.dev/@handle
export const handlePattern = /^[a-z0-9][a-z0-9_]{1,29}$/u
export const Handle = Schema.String.check(Schema.isPattern(handlePattern))
export type Handle = typeof Handle.Type

// Handles nobody can take: app routes, and names that would look official.
export const reservedHandles: ReadonlySet<string> = new Set([
  "about",
  "account",
  "admin",
  "administrator",
  "api",
  "assets",
  "auth",
  "c",
  "concept",
  "concepts",
  "explore",
  "feed",
  "feeds",
  "guide",
  "help",
  "learn",
  "lesson",
  "lessons",
  "library",
  "login",
  "logout",
  "me",
  "mod",
  "moderator",
  "new",
  "null",
  "official",
  "platform",
  "privacy",
  "root",
  "security",
  "settings",
  "signin",
  "signout",
  "staff",
  "static",
  "support",
  "system",
  "team",
  "terms",
  "undefined",
  "user",
  "users",
  "www",
])
export const isReservedHandle = (handle: string): boolean => reservedHandles.has(handle)

export const HandleUpdate = Schema.Struct({ handle: Handle })
export type HandleUpdate = typeof HandleUpdate.Type

// Unique per owner: learn.sirin.dev/@handle/slug
export const LessonSlug = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,79}$/u))
export type LessonSlug = typeof LessonSlug.Type

export const Visibility = Schema.Literals(["private", "unlisted", "public"])
export type Visibility = typeof Visibility.Type

// The dotted path in the curated tree, e.g. `physics.mechanics`.
export const CategoryId = Schema.String.check(Schema.isPattern(/^[a-z0-9-]+(\.[a-z0-9-]+){0,4}$/u))
export type CategoryId = typeof CategoryId.Type

// sha256 hex of a stored body; the R2 key is c/<hash>.json.
export const BodyHash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u))
export type BodyHash = typeof BodyHash.Type

// A tag as the author typed it. The server normalizes it (NFC, lowercase, dashes); one that is
// empty after that is a 422.
export const TagInput = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40))
export const maxTags = 5

export const Millis = Schema.Int

// ── Categories

export const Category = Schema.Struct({
  id: CategoryId,
  parent_id: Schema.NullOr(CategoryId),
  name_en: Schema.String,
  name_th: Schema.String,
  sort: Schema.Int,
})
export type Category = typeof Category.Type

// ── Me

export const Me = Schema.Struct({
  id: UserId,
  name: Schema.String,
  email: Schema.String,
  image: Schema.NullOr(Schema.String),
  handle: Schema.NullOr(Handle),
  bio: Schema.NullOr(Schema.String),
  lesson_count: Schema.Int,
})
export type Me = typeof Me.Type

// ── Lessons

export const LessonLangInfo = Schema.Struct({
  lang: LessonLang,
  version_id: LessonVersionId,
  n: Schema.Int,
  body_hash: BodyHash,
  title: Schema.String,
  summary: Schema.String,
  updated_at: Millis,
})
export type LessonLangInfo = typeof LessonLangInfo.Type

export const Lesson = Schema.Struct({
  id: LessonId,
  owner_handle: Handle,
  slug: LessonSlug,
  kind: LessonKind,
  default_lang: LessonLang,
  title: Schema.String,
  summary: Schema.String,
  category_id: Schema.NullOr(CategoryId),
  visibility: Visibility,
  tags: Schema.Array(Schema.String),
  langs: Schema.Array(LessonLangInfo),
  like_count: Schema.Int,
  published_at: Schema.NullOr(Millis),
  created_at: Millis,
  updated_at: Millis,
  // True when the signed-in viewer owns it (the web shows owner controls).
  is_owner: Schema.Boolean,
})
export type Lesson = typeof Lesson.Type

// A feed or library row.
export const LessonSummary = Schema.Struct({
  id: LessonId,
  owner_handle: Handle,
  slug: LessonSlug,
  kind: LessonKind,
  default_lang: LessonLang,
  title: Schema.String,
  summary: Schema.String,
  category_id: Schema.NullOr(CategoryId),
  visibility: Visibility,
  tags: Schema.Array(Schema.String),
  langs: Schema.Array(LessonLang),
  like_count: Schema.Int,
  published_at: Schema.NullOr(Millis),
  updated_at: Millis,
})
export type LessonSummary = typeof LessonSummary.Type

export const LessonVersion = Schema.Struct({
  id: LessonVersionId,
  lesson_id: LessonId,
  lang: LessonLang,
  n: Schema.Int,
  body_hash: BodyHash,
  body_bytes: Schema.Int,
  schema: Schema.Int,
  note: Schema.NullOr(Schema.String),
  created_at: Millis,
})
export type LessonVersion = typeof LessonVersion.Type

export const LessonUpdate = Schema.Struct({
  visibility: Schema.optionalKey(Visibility),
  category_id: Schema.optionalKey(Schema.NullOr(CategoryId)),
  tags: Schema.optionalKey(Schema.Array(TagInput).check(Schema.isMaxLength(maxTags))),
})
export type LessonUpdate = typeof LessonUpdate.Type

export const Published = Schema.Struct({ lesson: Lesson, version: LessonVersion })
export type Published = typeof Published.Type

// ── Keyset pages. The cursor is the last row's sort key, opaque on the wire (base64url JSON).

export const FeedCursorKey = Schema.Struct({ at: Millis, id: Uuid })
export const FeedCursor = Schema.StringFromBase64Url.pipe(
  Schema.decodeTo(Schema.fromJsonString(FeedCursorKey)),
)
export type FeedCursor = typeof FeedCursor.Type
export const PageLimit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))
export const defaultPageLimit = 20

export const LessonPage = Schema.Struct({
  items: Schema.Array(LessonSummary),
  next_cursor: Schema.NullOr(FeedCursor),
})
export type LessonPage = typeof LessonPage.Type

// ── Concepts

export const ConceptLangInfo = Schema.Struct({
  lang: LessonLang,
  version_id: ConceptVersionId,
  n: Schema.Int,
  body_hash: BodyHash,
  kind: Schema.String,
  title: Schema.String,
  aliases: Schema.Array(Schema.String),
})
export type ConceptLangInfo = typeof ConceptLangInfo.Type

export const Concept = Schema.Struct({
  slug: ConceptSlug,
  owner_handle: Handle,
  needs: Schema.Array(ConceptSlug),
  langs: Schema.Array(ConceptLangInfo),
})
export type Concept = typeof Concept.Type

export const ConceptHit = Schema.Struct({
  slug: ConceptSlug,
  lang: LessonLang,
  n: Schema.Int,
  body_hash: BodyHash,
  kind: Schema.String,
  title: Schema.String,
  aliases: Schema.Array(Schema.String),
})
export type ConceptHit = typeof ConceptHit.Type

export const ConceptSearch = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100))

export const ConceptPublished = Schema.Struct({
  slug: ConceptSlug,
  lang: LessonLang,
  n: Schema.Int,
  version_id: ConceptVersionId,
  body_hash: BodyHash,
})
export type ConceptPublished = typeof ConceptPublished.Type

// The concept versions a lesson version pinned at publish, with their bodies, so the reader
// renders every `{ concept }` card from one response.
export const ConceptBundleItem = Schema.Struct({
  card_id: Schema.String,
  slug: ConceptSlug,
  lang: LessonLang,
  n: Schema.Int,
  version_id: ConceptVersionId,
  body_hash: BodyHash,
  spec: ConceptSpec,
})
export type ConceptBundleItem = typeof ConceptBundleItem.Type
export const ConceptBundle = Schema.Struct({ items: Schema.Array(ConceptBundleItem) })
export type ConceptBundle = typeof ConceptBundle.Type

// A validator finding, as returned by @app/domain's checkLesson / checkConcept.
export const Issue = Schema.Struct({ path: Schema.String, code: Schema.String, message: Schema.String })
export type Issue = typeof Issue.Type
