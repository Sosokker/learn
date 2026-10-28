import { ConceptSlug, ConceptSpec, Id, LessonKind, LessonLang } from "@app/domain"
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
  // In the Worker's ADMIN_USER_IDS. The web shows the reports page; the server checks again on
  // every admin request.
  is_admin: Schema.Boolean,
})
export type Me = typeof Me.Type

// ── API tokens (ADR 0008): bearer credentials for pi and scripts/publish.ts

export const ApiTokenId = Uuid.pipe(Schema.brand("ApiTokenId"))
export type ApiTokenId = typeof ApiTokenId.Type

// `lrn_` + 32 random bytes in unpadded base64url (43 characters).
export const apiTokenPattern = /^lrn_[A-Za-z0-9_-]{43}$/u
// Active tokens per user; revoke one to make another.
export const maxApiTokens = 10

export const ApiTokenName = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(60),
)
export const ApiTokenCreate = Schema.Struct({ name: ApiTokenName })
export type ApiTokenCreate = typeof ApiTokenCreate.Type

// A token as the settings page lists it. `prefix` is the token's first characters, never the
// secret.
export const ApiToken = Schema.Struct({
  id: ApiTokenId,
  name: Schema.String,
  prefix: Schema.String,
  created_at: Millis,
  last_used_at: Schema.NullOr(Millis),
})
export type ApiToken = typeof ApiToken.Type

// The answer to a create: the only time the secret leaves the server.
export const ApiTokenCreated = Schema.Struct({ token: ApiToken, secret: Schema.String })
export type ApiTokenCreated = typeof ApiTokenCreated.Type

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

// ── Likes, bookmarks and reading progress (private to the signed-in user)

// A lesson section id (the same in every language of a lesson).
export const SectionId = Id
export type SectionId = typeof SectionId.Type
// Progress keeps at most this many section ids; a longer lesson stops counting there.
export const maxProgressSections = 200

// What the reader reports, at most every few seconds and only when it changed: the sections that
// came into view, the last one (to resume there), and how many the version has.
export const ProgressUpdate = Schema.Struct({
  version_id: LessonVersionId,
  last: Schema.NullOr(SectionId),
  seen: Schema.Array(SectionId).check(Schema.isMaxLength(maxProgressSections)),
  total: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: maxProgressSections })),
})
export type ProgressUpdate = typeof ProgressUpdate.Type

export const Progress = Schema.Struct({
  version_id: LessonVersionId,
  lang: LessonLang,
  last: Schema.NullOr(SectionId),
  seen: Schema.Array(SectionId),
  total: Schema.Int,
  // Every section was seen.
  done: Schema.Boolean,
  updated_at: Millis,
})
export type Progress = typeof Progress.Type

// The signed-in viewer's own state on a lesson, sent with the lesson so the page needs no second
// request. Null for anonymous readers.
export const ViewerState = Schema.Struct({
  liked: Schema.Boolean,
  bookmarked: Schema.Boolean,
  progress: Schema.NullOr(Progress),
})
export type ViewerState = typeof ViewerState.Type

// The answer to a like or unlike: the state after it, and the lesson's count.
export const LikeState = Schema.Struct({ liked: Schema.Boolean, like_count: Schema.Int })
export type LikeState = typeof LikeState.Type

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
  // Comments everyone sees (not deleted, not hidden).
  comment_count: Schema.Int,
  published_at: Schema.NullOr(Millis),
  created_at: Millis,
  updated_at: Millis,
  // True when the signed-in viewer owns it (the web shows owner controls).
  is_owner: Schema.Boolean,
  viewer: Schema.NullOr(ViewerState),
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

// The answer to a publish. `created` tells the two apart (and the status: 201 for a new version,
// 200 when the body is byte-identical to the language's current version and pins the same concept
// versions, so nothing was written and `version` is the current one).
export const Published = Schema.Struct({
  lesson: Lesson,
  version: LessonVersion,
  created: Schema.Literal(true),
})
export type Published = typeof Published.Type
export const PublishUnchanged = Schema.Struct({
  lesson: Lesson,
  version: LessonVersion,
  created: Schema.Literal(false),
})
export type PublishUnchanged = typeof PublishUnchanged.Type

// The answer to a lesson-level publish: one entry per language the caller sent, each saying
// whether it wrote a new version. `created` is true when at least one version was written, so
// the status is 201; when every version was already current it is 200.
export const PublishedVersion = Schema.Struct({
  version: LessonVersion,
  created: Schema.Boolean,
})
export type PublishedVersion = typeof PublishedVersion.Type

export const PublishedLesson = Schema.Struct({
  lesson: Lesson,
  versions: Schema.Array(PublishedVersion),
  created: Schema.Literal(true),
})
export type PublishedLesson = typeof PublishedLesson.Type

export const PublishLessonUnchanged = Schema.Struct({
  lesson: Lesson,
  versions: Schema.Array(PublishedVersion),
  created: Schema.Literal(false),
})
export type PublishLessonUnchanged = typeof PublishLessonUnchanged.Type

// ── Keyset pages. The cursor is the last row's sort key, opaque on the wire (base64url JSON).

// `at` is the sort value: a time in milliseconds, or a hot score (a float) for the hot feeds.
export const FeedCursorKey = Schema.Struct({ at: Schema.Finite, id: Uuid })
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

// "Continue learning": unfinished lessons, most recently read first.
export const ProgressItem = Schema.Struct({ lesson: LessonSummary, progress: Progress })
export type ProgressItem = typeof ProgressItem.Type
export const ProgressPage = Schema.Struct({
  items: Schema.Array(ProgressItem),
  next_cursor: Schema.NullOr(FeedCursor),
})
export type ProgressPage = typeof ProgressPage.Type

// Feed sort orders. `hot` is by hot_score (recomputed by the cron every 30 minutes, so a later
// page can repeat or skip a lesson whose score changed in between).
export const FeedSort = Schema.Literals(["new", "hot"])
export type FeedSort = typeof FeedSort.Type

// ── Lesson search

export const LessonSearchText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100))

// The best matches by bm25 rank, one page only (see LessonSearch in packages/services). Each hit
// shows the title and summary of the language that matched.
export const LessonHits = Schema.Struct({ items: Schema.Array(LessonSummary) })
export type LessonHits = typeof LessonHits.Type

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

// Like Published: `created: false` (status 200) when the body is identical to the language's
// current version, which is returned unchanged.
const conceptPublishedFields = {
  slug: ConceptSlug,
  lang: LessonLang,
  n: Schema.Int,
  version_id: ConceptVersionId,
  body_hash: BodyHash,
}
export const ConceptPublished = Schema.Struct({ ...conceptPublishedFields, created: Schema.Literal(true) })
export type ConceptPublished = typeof ConceptPublished.Type
export const ConceptUnchanged = Schema.Struct({ ...conceptPublishedFields, created: Schema.Literal(false) })
export type ConceptUnchanged = typeof ConceptUnchanged.Type

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

// ── Comments (design §6.11)

export const CommentId = Uuid.pipe(Schema.brand("CommentId"))
export type CommentId = typeof CommentId.Type

// What a comment points at: the whole lesson, or one part, card, section or item, named as the
// renderer's target keys. Ids are the same in every language and stay across versions.
export const commentAnchorPattern =
  /^(lesson|(part|card|section):[a-z][a-z0-9_]{0,31}|item:[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{0,31})$/u
export const CommentAnchor = Schema.String.check(Schema.isPattern(commentAnchorPattern))
export type CommentAnchor = typeof CommentAnchor.Type

export const maxCommentLength = 2000
// Replies per top-level comment, deleted ones included. Bounds the rows a page of threads reads.
export const maxReplies = 50

// Plain text (ADR 0004): shown as text, never parsed as markup. The client trims it.
export const CommentBody = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(maxCommentLength),
)

// `visible`; `hidden` by a moderator, shown only to its author, the lesson owner and admins;
// `deleted` by its author; `removed`: hidden, as everyone else sees it. Deleted and removed
// comments have no body and no author, and are listed only to keep a thread with replies.
export const CommentStatus = Schema.Literals(["visible", "hidden", "deleted", "removed"])
export type CommentStatus = typeof CommentStatus.Type

export const CommentHiddenBy = Schema.Literals(["owner", "admin"])
export type CommentHiddenBy = typeof CommentHiddenBy.Type

export const Comment = Schema.Struct({
  id: CommentId,
  lesson_id: LessonId,
  parent_id: Schema.NullOr(CommentId),
  anchor: CommentAnchor,
  // The version (and its language) the author was reading.
  version_id: LessonVersionId,
  lang: LessonLang,
  author_handle: Schema.NullOr(Handle),
  body: Schema.String,
  status: CommentStatus,
  hidden_by: Schema.NullOr(CommentHiddenBy),
  is_author: Schema.Boolean,
  reply_count: Schema.Int,
  created_at: Millis,
  edited_at: Schema.NullOr(Millis),
})
export type Comment = typeof Comment.Type

// A top-level comment with its replies, oldest reply first.
export const CommentThread = Schema.Struct({ ...Comment.fields, replies: Schema.Array(Comment) })
export type CommentThread = typeof CommentThread.Type

// Threads, newest first.
export const CommentPage = Schema.Struct({
  items: Schema.Array(CommentThread),
  next_cursor: Schema.NullOr(FeedCursor),
})
export type CommentPage = typeof CommentPage.Type

// A reply takes its parent's anchor; `anchor` is ignored then.
export const CommentCreate = Schema.Struct({
  version_id: LessonVersionId,
  anchor: CommentAnchor,
  body: CommentBody,
  parent_id: Schema.optionalKey(CommentId),
})
export type CommentCreate = typeof CommentCreate.Type

export const CommentUpdate = Schema.Struct({ body: CommentBody })
export type CommentUpdate = typeof CommentUpdate.Type

// ── Reports (moderation)

export const ReportId = Uuid.pipe(Schema.brand("ReportId"))
export type ReportId = typeof ReportId.Type

export const ReportTargetType = Schema.Literals(["lesson", "comment"])
export type ReportTargetType = typeof ReportTargetType.Type
export const ReportReason = Schema.Literals(["spam", "abuse", "wrong", "other"])
export type ReportReason = typeof ReportReason.Type
export const maxReportNote = 500

export const ReportCreate = Schema.Struct({
  target_type: ReportTargetType,
  // A lesson id or a comment id.
  target_id: Uuid,
  reason: ReportReason,
  note: Schema.optionalKey(Schema.String.check(Schema.isTrimmed(), Schema.isMaxLength(maxReportNote))),
})
export type ReportCreate = typeof ReportCreate.Type

// What the admin queue shows of a reported lesson or comment.
export const ReportedLesson = Schema.Struct({
  id: LessonId,
  owner_handle: Handle,
  // A deleted lesson's slug carries `~<id>`, so this is not a LessonSlug.
  slug: Schema.String,
  title: Schema.String,
  visibility: Visibility,
  deleted: Schema.Boolean,
})
export type ReportedLesson = typeof ReportedLesson.Type

export const ReportedComment = Schema.Struct({
  id: CommentId,
  anchor: CommentAnchor,
  author_handle: Schema.NullOr(Handle),
  body: Schema.String,
  hidden_by: Schema.NullOr(CommentHiddenBy),
  deleted: Schema.Boolean,
})
export type ReportedComment = typeof ReportedComment.Type

export const AdminReport = Schema.Struct({
  id: ReportId,
  target_type: ReportTargetType,
  target_id: Schema.String,
  reason: ReportReason,
  note: Schema.NullOr(Schema.String),
  reporter_handle: Schema.NullOr(Handle),
  created_at: Millis,
  // The lesson reported, or the lesson of the comment reported. Null if it is gone.
  lesson: Schema.NullOr(ReportedLesson),
  comment: Schema.NullOr(ReportedComment),
})
export type AdminReport = typeof AdminReport.Type

// Open reports, newest first.
export const ReportPage = Schema.Struct({
  items: Schema.Array(AdminReport),
  next_cursor: Schema.NullOr(FeedCursor),
})
export type ReportPage = typeof ReportPage.Type

// Closes every open report of the same target.
export const ReportResolve = Schema.Struct({ status: Schema.Literals(["resolved", "dismissed"]) })
export type ReportResolve = typeof ReportResolve.Type

// A validator finding, as returned by @app/domain's checkLesson / checkConcept.
export const Issue = Schema.Struct({ path: Schema.String, code: Schema.String, message: Schema.String })
export type Issue = typeof Issue.Type

// The bodies of one lesson to check without writing (an external agent sends en and th together,
// so cross-language parity is checked before the first publish). The service enforces 1–2 specs
// and the 512 KB body cap; the whole request shares the publish body limit.
export const LessonValidate = Schema.Struct({ specs: Schema.Array(Schema.Unknown) })
export type LessonValidate = typeof LessonValidate.Type

// The result of a dry run: `valid` is true only when there are no issues. Invalid input is a 200,
// not an error: the agent reads the issues and repairs the lesson.
export const LessonValidation = Schema.Struct({
  valid: Schema.Boolean,
  issues: Schema.Array(Issue),
})
export type LessonValidation = typeof LessonValidation.Type
