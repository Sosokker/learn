import { LessonKind, LessonLang, LessonSpec } from "@app/domain"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import {
  Admin,
  ApiTokenLimit,
  ApiTokenNotFound,
  Authenticated,
  BodyLimit,
  ByokKeyMissing,
  ByokKeyNotFound,
  ByokUnavailable,
  CategoryNotFound,
  CommentNotFound,
  ConceptForbidden,
  ConceptNotFound,
  GenerationBusy,
  GenerationNotFound,
  GenerationQuotaExceeded,
  GenerationUnavailable,
  HandleTaken,
  InvalidByokKey,
  InvalidComment,
  InvalidConcept,
  InvalidGeneration,
  InvalidHandle,
  InvalidLesson,
  InvalidSettings,
  LessonNotFound,
  PayloadTooLarge,
  PlatformBillingUnavailable,
  ReportNotFound,
  SessionAuthenticated,
  UnsupportedFilter,
  VersionNotFound,
  Viewer,
} from "./errors.ts"
import {
  ApiToken,
  ApiTokenCreate,
  ApiTokenCreated,
  ApiTokenId,
  ByokKey,
  ByokKeySet,
  ByokProvider,
  Category,
  CategoryId,
  Comment,
  CommentAnchor,
  CommentCreate,
  CommentId,
  CommentPage,
  CommentUpdate,
  Concept,
  ConceptBundle,
  ConceptHit,
  ConceptPublished,
  ConceptSearch,
  ConceptUnchanged,
  FeedCursor,
  FeedSort,
  Generation,
  GenerationCreate,
  GenerationId,
  GenerationOptions,
  GenerationPage,
  Handle,
  HandleUpdate,
  Lesson,
  LessonHits,
  LessonId,
  LessonPage,
  LessonSearchText,
  LessonSlug,
  LessonUpdate,
  LessonVersion,
  LessonVersionId,
  LikeState,
  Me,
  PageLimit,
  ProgressPage,
  ProgressUpdate,
  Published,
  PublishUnchanged,
  ReportCreate,
  ReportId,
  ReportPage,
  ReportResolve,
} from "./models.ts"

export class NotReady extends Schema.TaggedError<NotReady>()("NotReady", {}, { httpApiStatus: 503 }) {}

// A JSON body taken as raw bytes: the server measures, hashes and validates it itself (a
// LessonSpec is decoded strictly, and the stored body must be the exact bytes that were hashed).
const JsonBytes = Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array({ contentType: "application/json" }))

const pageQuery = { cursor: Schema.optionalKey(FeedCursor), limit: Schema.optionalKey(PageLimit) }

export class SystemApi extends HttpApiGroup.make("system", { topLevel: true }).add(
  // Liveness: constant, touches nothing.
  HttpApiEndpoint.get("health", "/health", { success: Schema.Struct({ status: Schema.Literal("ok") }) }),
  // Readiness: D1 answers.
  HttpApiEndpoint.get("ready", "/health/ready", {
    success: Schema.Struct({ status: Schema.Literal("ok") }),
    error: NotReady,
  }),
) {}

export class MeApi extends HttpApiGroup.make("me")
  .add(HttpApiEndpoint.get("get", "/me", { success: Me }))
  // Change the public handle (learn.sirin.dev/@handle). Links to the old handle stop working.
  .add(
    HttpApiEndpoint.patch("update", "/me", {
      payload: HandleUpdate,
      success: Me,
      error: [InvalidHandle, HandleTaken],
    }),
  )
  .middleware(Authenticated) {}

// API tokens for pi (ADR 0008). Session cookie only: a token cannot manage tokens.
export class TokensApi extends HttpApiGroup.make("tokens")
  // Active tokens, newest first (at most maxApiTokens).
  .add(HttpApiEndpoint.get("list", "/me/tokens", { success: Schema.Array(ApiToken) }))
  // The answer holds the secret, once; it is never shown again.
  .add(
    HttpApiEndpoint.post("create", "/me/tokens", {
      payload: ApiTokenCreate,
      success: ApiTokenCreated.pipe(HttpApiSchema.status(201)),
      error: ApiTokenLimit,
    }),
  )
  // Owner only: anyone else's token id is the same 404 as a missing one.
  .add(
    HttpApiEndpoint.delete("revoke", "/me/tokens/:id", {
      params: { id: ApiTokenId },
      success: HttpApiSchema.NoContent,
      error: ApiTokenNotFound,
    }),
  )
  .middleware(SessionAuthenticated) {}

export class CategoriesApi extends HttpApiGroup.make("categories").add(
  // The whole curated tree (a few dozen rows); the client builds the tree from parent_id.
  HttpApiEndpoint.get("list", "/categories", { success: Schema.Array(Category) }),
) {}

export class LessonsApi extends HttpApiGroup.make("lessons").add(
  // Full-text search over the title and summary of public lessons, every language (Thai split into
  // words). The best `limit` matches by rank; no further pages (see LessonSearch).
  HttpApiEndpoint.get("search", "/lessons/search", {
    query: {
      q: LessonSearchText,
      lang: Schema.optionalKey(LessonLang),
      limit: Schema.optionalKey(PageLimit),
    },
    success: LessonHits,
  }),
  // Public reads. A private lesson is a 404 unless the viewer owns it.
  HttpApiEndpoint.get("get", "/lessons/:id", {
    params: { id: LessonId },
    success: Lesson,
    error: LessonNotFound,
  }).middleware(Viewer),
  HttpApiEndpoint.get("getBySlug", "/lessons/by/:handle/:slug", {
    params: { handle: Handle, slug: LessonSlug },
    success: Lesson,
    error: LessonNotFound,
  }).middleware(Viewer),
  HttpApiEndpoint.get("versions", "/lessons/:id/versions", {
    params: { id: LessonId },
    query: { lang: Schema.optionalKey(LessonLang) },
    success: Schema.Array(LessonVersion),
    error: LessonNotFound,
  }).middleware(Viewer),
  // The body through the API, with the same access check as the lesson: the only way to read a
  // private lesson's body. Public and unlisted readers should prefer `/c/<hash>.json` (edge cached).
  HttpApiEndpoint.get("body", "/lessons/:id/versions/:versionId/body", {
    params: { id: LessonId, versionId: LessonVersionId },
    success: LessonSpec,
    error: [LessonNotFound, VersionNotFound],
  }).middleware(Viewer),
  HttpApiEndpoint.get("concepts", "/lessons/:id/versions/:versionId/concepts", {
    params: { id: LessonId, versionId: LessonVersionId },
    success: ConceptBundle,
    error: [LessonNotFound, VersionNotFound],
  }).middleware(Viewer),
  // Owner only (anyone else gets the 404).
  HttpApiEndpoint.patch("update", "/lessons/:id", {
    params: { id: LessonId },
    payload: LessonUpdate,
    success: Lesson,
    error: [LessonNotFound, InvalidSettings],
  }).middleware(Authenticated),
  HttpApiEndpoint.delete("delete", "/lessons/:id", {
    params: { id: LessonId },
    success: HttpApiSchema.NoContent,
    error: LessonNotFound,
  }).middleware(Authenticated),
  // The signed-in user's library, every visibility, most recently changed first.
  HttpApiEndpoint.get("mine", "/me/lessons", { query: pageQuery, success: LessonPage }).middleware(
    Authenticated,
  ),
  // pi's /publish: the body is one LessonSpec JSON. Creates the lesson (private) on first publish
  // and adds the next version of the spec's language.
  HttpApiEndpoint.post("publish", "/me/lessons/:slug/versions", {
    params: { slug: LessonSlug },
    payload: JsonBytes,
    // 201 with a new version; 200 when the body is identical to the current one (nothing written).
    success: [Published.pipe(HttpApiSchema.status(201)), PublishUnchanged],
    error: [InvalidLesson, PayloadTooLarge],
  })
    .middleware(BodyLimit)
    .middleware(Authenticated),
) {}

// The signed-in user's likes, bookmarks and reading progress. Each write is idempotent (a second
// like changes nothing) and works only on a lesson the user can read: anyone else's private
// lesson is the same 404 as a missing one. The lesson read (`viewer`) says what is set already.
export class EngagementApi extends HttpApiGroup.make("engagement")
  .add(
    HttpApiEndpoint.put("like", "/lessons/:id/like", {
      params: { id: LessonId },
      success: LikeState,
      error: LessonNotFound,
    }),
  )
  .add(
    HttpApiEndpoint.delete("unlike", "/lessons/:id/like", {
      params: { id: LessonId },
      success: LikeState,
      error: LessonNotFound,
    }),
  )
  .add(
    HttpApiEndpoint.put("bookmark", "/lessons/:id/bookmark", {
      params: { id: LessonId },
      success: HttpApiSchema.NoContent,
      error: LessonNotFound,
    }),
  )
  .add(
    HttpApiEndpoint.delete("unbookmark", "/lessons/:id/bookmark", {
      params: { id: LessonId },
      success: HttpApiSchema.NoContent,
      error: LessonNotFound,
    }),
  )
  // Replaces the reading progress of one lesson. Unchanged progress writes nothing.
  .add(
    HttpApiEndpoint.put("saveProgress", "/lessons/:id/progress", {
      params: { id: LessonId },
      payload: ProgressUpdate,
      success: HttpApiSchema.NoContent,
      error: [LessonNotFound, VersionNotFound],
    }),
  )
  // Bookmarked lessons the user can still read, most recently bookmarked first.
  .add(HttpApiEndpoint.get("bookmarks", "/me/bookmarks", { query: pageQuery, success: LessonPage }))
  // "Continue learning": unfinished lessons the user can still read, most recently read first.
  .add(HttpApiEndpoint.get("progress", "/me/progress", { query: pageQuery, success: ProgressPage }))
  .middleware(Authenticated) {}

// Every filter here is one index range (D1 bills rows scanned); a combination no index covers is a
// 400 UnsupportedFilter rather than a scan.
export class FeedsApi extends HttpApiGroup.make("feeds").add(
  // Public lessons, newest first (first-public time). `kind` or `lang` (lessons with a version in
  // that language, shown in it), not both.
  HttpApiEndpoint.get("new", "/feeds/new", {
    query: { ...pageQuery, kind: Schema.optionalKey(LessonKind), lang: Schema.optionalKey(LessonLang) },
    success: LessonPage,
    error: UnsupportedFilter,
  }),
  // Public lessons by hot score, optionally of one kind.
  HttpApiEndpoint.get("hot", "/feeds/hot", {
    query: { ...pageQuery, kind: Schema.optionalKey(LessonKind) },
    success: LessonPage,
  }),
  // A category and its sub-categories, newest first.
  HttpApiEndpoint.get("category", "/feeds/categories/:id", {
    params: { id: CategoryId },
    query: pageQuery,
    success: LessonPage,
    error: CategoryNotFound,
  }),
  HttpApiEndpoint.get("tag", "/feeds/tags/:slug", {
    params: { slug: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40)) },
    query: { ...pageQuery, sort: Schema.optionalKey(FeedSort) },
    success: LessonPage,
  }),
) {}

export class ConceptsApi extends HttpApiGroup.make("concepts").add(
  // Full-text search over titles, aliases and bodies (Thai split into words). The lesson-writing
  // agent calls this before writing a card, to reuse a concept instead.
  HttpApiEndpoint.get("search", "/concepts", {
    query: {
      q: ConceptSearch,
      lang: Schema.optionalKey(LessonLang),
      limit: Schema.optionalKey(PageLimit),
    },
    success: Schema.Array(ConceptHit),
  }),
  HttpApiEndpoint.get("get", "/concepts/:slug", {
    params: { slug: Schema.String.check(Schema.isMaxLength(200)) },
    success: Concept,
    error: ConceptNotFound,
  }),
  // Body: one ConceptSpec JSON. Creates the concept, or adds the next version of its language.
  HttpApiEndpoint.post("publish", "/concepts", {
    payload: JsonBytes,
    success: [ConceptPublished.pipe(HttpApiSchema.status(201)), ConceptUnchanged],
    error: [InvalidConcept, ConceptForbidden, PayloadTooLarge],
  })
    .middleware(BodyLimit)
    .middleware(Authenticated),
) {}

// Comments on a lesson (design §6.11). Every endpoint first checks that the caller can read the
// lesson: anyone else's private lesson is the same 404 as a missing one.
export class CommentsApi extends HttpApiGroup.make("comments")
  // Threads, newest first; `anchor` keeps one anchor's threads.
  .add(
    HttpApiEndpoint.get("list", "/lessons/:id/comments", {
      params: { id: LessonId },
      query: { ...pageQuery, anchor: Schema.optionalKey(CommentAnchor) },
      success: CommentPage,
      error: LessonNotFound,
    }).middleware(Viewer),
  )
  .add(
    HttpApiEndpoint.post("create", "/lessons/:id/comments", {
      params: { id: LessonId },
      payload: CommentCreate,
      success: Comment.pipe(HttpApiSchema.status(201)),
      error: [LessonNotFound, VersionNotFound, CommentNotFound, InvalidComment],
    }).middleware(Authenticated),
  )
  // The author only.
  .add(
    HttpApiEndpoint.patch("update", "/lessons/:id/comments/:commentId", {
      params: { id: LessonId, commentId: CommentId },
      payload: CommentUpdate,
      success: Comment,
      error: [LessonNotFound, CommentNotFound],
    }).middleware(Authenticated),
  )
  // The author only. Soft: the body goes, the thread stays.
  .add(
    HttpApiEndpoint.delete("delete", "/lessons/:id/comments/:commentId", {
      params: { id: LessonId, commentId: CommentId },
      success: HttpApiSchema.NoContent,
      error: [LessonNotFound, CommentNotFound],
    }).middleware(Authenticated),
  )
  // The lesson's owner moderates its comments. Unhide undoes only the owner's own hide.
  .add(
    HttpApiEndpoint.put("hide", "/lessons/:id/comments/:commentId/hidden", {
      params: { id: LessonId, commentId: CommentId },
      success: Comment,
      error: [LessonNotFound, CommentNotFound],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.delete("unhide", "/lessons/:id/comments/:commentId/hidden", {
      params: { id: LessonId, commentId: CommentId },
      success: Comment,
      error: [LessonNotFound, CommentNotFound],
    }).middleware(Authenticated),
  ) {}

// Any signed-in user reports a lesson or comment they can see. A second open report of the same
// target by the same user changes nothing. Nobody but admins lists reports.
export class ReportsApi extends HttpApiGroup.make("reports").add(
  HttpApiEndpoint.post("create", "/reports", {
    payload: ReportCreate,
    success: HttpApiSchema.NoContent,
    error: [LessonNotFound, CommentNotFound],
  }).middleware(Authenticated),
) {}

// Moderation, for the users in ADMIN_USER_IDS (session cookie only). Everyone else gets a plain
// 404, as for a path that does not exist.
export class AdminApi extends HttpApiGroup.make("admin")
  .add(HttpApiEndpoint.get("reports", "/admin/reports", { query: pageQuery, success: ReportPage }))
  .add(
    HttpApiEndpoint.post("resolve", "/admin/reports/:id/resolve", {
      params: { id: ReportId },
      payload: ReportResolve,
      success: HttpApiSchema.NoContent,
      error: ReportNotFound,
    }),
  )
  .add(
    HttpApiEndpoint.put("hideComment", "/admin/comments/:id/hidden", {
      params: { id: CommentId },
      success: HttpApiSchema.NoContent,
      error: CommentNotFound,
    }),
  )
  .add(
    HttpApiEndpoint.delete("unhideComment", "/admin/comments/:id/hidden", {
      params: { id: CommentId },
      success: HttpApiSchema.NoContent,
      error: CommentNotFound,
    }),
  )
  .middleware(Admin) {}

// The user's own provider keys for AI generation (BYOK). Session cookie only, like tokens: a leaked
// API token cannot read which keys exist or replace them. No endpoint returns a key.
export class KeysApi extends HttpApiGroup.make("keys")
  .add(HttpApiEndpoint.get("list", "/me/keys", { success: Schema.Array(ByokKey) }))
  // Sets or replaces the key of one provider.
  .add(
    HttpApiEndpoint.put("set", "/me/keys/:provider", {
      params: { provider: ByokProvider },
      payload: ByokKeySet,
      success: ByokKey,
      error: [InvalidByokKey, ByokUnavailable],
    }),
  )
  .add(
    HttpApiEndpoint.delete("remove", "/me/keys/:provider", {
      params: { provider: ByokProvider },
      success: HttpApiSchema.NoContent,
      error: ByokKeyNotFound,
    }),
  )
  .middleware(SessionAuthenticated) {}

// AI lesson generation (ADR 0009). A job runs in its own Durable Object and saves its result as a
// private lesson of the user. Another user's job is the same 404 as a missing one. Starting and
// canceling a job need the session cookie: a job spends money (the platform's or the user's own
// key), so a leaked API token cannot start one. Reads also accept a token.
export class GenerationsApi extends HttpApiGroup.make("generations")
  // Models, today's platform quota, and the user's stored keys (provider + last4).
  .add(
    HttpApiEndpoint.get("options", "/generations/options", {
      success: GenerationOptions,
      error: GenerationUnavailable,
    }).middleware(Authenticated),
  )
  // Checks the quota (platform) or the stored key (BYOK), then starts the job.
  .add(
    HttpApiEndpoint.post("create", "/generations", {
      payload: GenerationCreate,
      success: Generation.pipe(HttpApiSchema.status(201)),
      error: [
        InvalidGeneration,
        PlatformBillingUnavailable,
        GenerationQuotaExceeded,
        GenerationBusy,
        ByokKeyMissing,
        GenerationUnavailable,
      ],
    }).middleware(SessionAuthenticated),
  )
  // The user's jobs, newest first.
  .add(
    HttpApiEndpoint.get("list", "/generations", { query: pageQuery, success: GenerationPage }).middleware(
      Authenticated,
    ),
  )
  .add(
    HttpApiEndpoint.get("get", "/generations/:id", {
      params: { id: GenerationId },
      success: Generation,
      error: GenerationNotFound,
    }).middleware(Authenticated),
  )
  // Progress as Server-Sent Events (`text/event-stream`, each `data:` a GenerationEvent). Replays
  // from the start, or after `Last-Event-ID` when the browser reconnects; ends after `done`.
  .add(
    HttpApiEndpoint.get("events", "/generations/:id/events", {
      params: { id: GenerationId },
      success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" })),
      error: GenerationNotFound,
    }).middleware(Authenticated),
  )
  // Stops a queued or running job. A finished job is returned as it is.
  .add(
    HttpApiEndpoint.post("cancel", "/generations/:id/cancel", {
      params: { id: GenerationId },
      success: Generation,
      error: GenerationNotFound,
    }).middleware(SessionAuthenticated),
  ) {}

export class Api extends HttpApi.make("learn")
  .add(SystemApi)
  .add(MeApi)
  .add(TokensApi)
  .add(CategoriesApi)
  .add(LessonsApi)
  .add(EngagementApi)
  .add(FeedsApi)
  .add(ConceptsApi)
  .add(CommentsApi)
  .add(ReportsApi)
  .add(AdminApi)
  .add(KeysApi)
  .add(GenerationsApi)
  .prefix("/api")
  .annotateMerge(OpenApi.annotations({ title: "Learn API" })) {}
