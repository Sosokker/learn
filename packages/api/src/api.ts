import { LessonLang, LessonSpec } from "@app/domain"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import {
  Authenticated,
  BodyLimit,
  CategoryNotFound,
  ConceptForbidden,
  ConceptNotFound,
  HandleTaken,
  InvalidConcept,
  InvalidHandle,
  InvalidLesson,
  InvalidSettings,
  LessonNotFound,
  PayloadTooLarge,
  VersionNotFound,
  Viewer,
} from "./errors.ts"
import {
  Category,
  CategoryId,
  Concept,
  ConceptBundle,
  ConceptHit,
  ConceptPublished,
  ConceptSearch,
  FeedCursor,
  Handle,
  HandleUpdate,
  Lesson,
  LessonId,
  LessonPage,
  LessonSlug,
  LessonUpdate,
  LessonVersion,
  LessonVersionId,
  Me,
  PageLimit,
  Published,
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

export class CategoriesApi extends HttpApiGroup.make("categories").add(
  // The whole curated tree (a few dozen rows); the client builds the tree from parent_id.
  HttpApiEndpoint.get("list", "/categories", { success: Schema.Array(Category) }),
) {}

export class LessonsApi extends HttpApiGroup.make("lessons").add(
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
    success: Published.pipe(HttpApiSchema.status(201)),
    error: [InvalidLesson, PayloadTooLarge],
  })
    .middleware(BodyLimit)
    .middleware(Authenticated),
) {}

export class FeedsApi extends HttpApiGroup.make("feeds").add(
  // Public lessons, newest first (first-public time).
  HttpApiEndpoint.get("new", "/feeds/new", { query: pageQuery, success: LessonPage }),
  // A category and its sub-categories.
  HttpApiEndpoint.get("category", "/feeds/categories/:id", {
    params: { id: CategoryId },
    query: pageQuery,
    success: LessonPage,
    error: CategoryNotFound,
  }),
  HttpApiEndpoint.get("tag", "/feeds/tags/:slug", {
    params: { slug: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40)) },
    query: pageQuery,
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
    success: ConceptPublished.pipe(HttpApiSchema.status(201)),
    error: [InvalidConcept, ConceptForbidden, PayloadTooLarge],
  })
    .middleware(BodyLimit)
    .middleware(Authenticated),
) {}

export class Api extends HttpApi.make("learn")
  .add(SystemApi)
  .add(MeApi)
  .add(CategoriesApi)
  .add(LessonsApi)
  .add(FeedsApi)
  .add(ConceptsApi)
  .prefix("/api")
  .annotateMerge(OpenApi.annotations({ title: "Learn API" })) {}
