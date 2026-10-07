import {
  AddVersion,
  ApiTokenInfo,
  Category,
  ConceptBundle,
  ConceptDetail,
  ConceptSlug,
  ConceptSpec,
  ConceptSummary,
  Conflict,
  CreatedApiToken,
  CreateLesson,
  FeedSort,
  Forbidden,
  Handle,
  Invalid,
  LessonDetail,
  LessonId,
  LessonKind,
  LessonLang,
  LessonSlug,
  LessonSpec,
  LessonSummary,
  Me,
  NotFound,
  Page,
  TagSlug,
  Unauthorized,
  UpdateLesson,
  UpdateMe,
  VersionId,
} from "@app/domain"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import { Session } from "./Session.ts"

export class SystemApi extends HttpApiGroup.make("system").add(
  HttpApiEndpoint.get("health", "/health", { success: Schema.Struct({ ok: Schema.Boolean }) }),
  HttpApiEndpoint.get("categories", "/categories", { success: Schema.Array(Category) }),
) {}

export class MeApi extends HttpApiGroup.make("me")
  .add(
    HttpApiEndpoint.get("get", "/me", { success: Me, error: Unauthorized }),
    HttpApiEndpoint.patch("update", "/me", {
      payload: UpdateMe,
      success: Me,
      error: [Unauthorized, Conflict],
    }),
    HttpApiEndpoint.get("tokens", "/me/tokens", { success: Schema.Array(ApiTokenInfo), error: Unauthorized }),
    HttpApiEndpoint.post("createToken", "/me/tokens", {
      payload: Schema.Struct({ name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(60)) }),
      success: CreatedApiToken,
      error: Unauthorized,
    }),
    HttpApiEndpoint.delete("revokeToken", "/me/tokens/:id", {
      params: { id: Schema.String },
      success: HttpApiSchema.NoContent,
      error: [Unauthorized, NotFound],
    }),
  )
  .middleware(Session) {}

const FeedQuery = {
  sort: Schema.optional(FeedSort),
  kind: Schema.optional(LessonKind),
  lang: Schema.optional(LessonLang),
  // Comma-separated: a category and its children (the client knows the tree).
  categories: Schema.optional(Schema.String),
  tag: Schema.optional(TagSlug),
  q: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
}

export class LessonsApi extends HttpApiGroup.make("lessons")
  .add(
    // Public lessons only. Anonymous responses are edge-cached for 60 s.
    HttpApiEndpoint.get("feed", "/feed", { query: FeedQuery, success: Page(LessonSummary) }),
    // The signed-in user's own lessons, every visibility.
    HttpApiEndpoint.get("library", "/library", {
      query: { cursor: Schema.optional(Schema.String) },
      success: Page(LessonSummary),
      error: Unauthorized,
    }),
    HttpApiEndpoint.get("byHandle", "/lessons/@:handle/:slug", {
      params: { handle: Handle, slug: LessonSlug },
      success: LessonDetail,
      error: NotFound,
    }),
    HttpApiEndpoint.get("get", "/lessons/:id", {
      params: { id: LessonId },
      success: LessonDetail,
      error: NotFound,
    }),
    // The body of a version, for readers allowed to see the lesson. Public and unlisted bodies are
    // also at /c/<hash>.json, which the edge caches; private ones only come through here.
    HttpApiEndpoint.get("body", "/lessons/:id/body/:lang", {
      params: { id: LessonId, lang: LessonLang },
      success: LessonSpec,
      error: NotFound,
    }),
    HttpApiEndpoint.get("concepts", "/versions/:versionId/concepts", {
      params: { versionId: VersionId },
      success: ConceptBundle,
      error: NotFound,
    }),
    HttpApiEndpoint.post("create", "/lessons", {
      payload: CreateLesson,
      success: LessonDetail,
      error: [Unauthorized, Conflict, Invalid],
    }),
    // Adds a version in `spec.lang`. A new language is a translation: its ids must match.
    HttpApiEndpoint.post("addVersion", "/lessons/:id/versions", {
      params: { id: LessonId },
      payload: AddVersion,
      success: LessonDetail,
      error: [Unauthorized, NotFound, Invalid],
    }),
    HttpApiEndpoint.patch("update", "/lessons/:id", {
      params: { id: LessonId },
      payload: UpdateLesson,
      success: LessonDetail,
      error: [Unauthorized, NotFound, Conflict, Invalid],
    }),
    HttpApiEndpoint.delete("remove", "/lessons/:id", {
      params: { id: LessonId },
      success: HttpApiSchema.NoContent,
      error: [Unauthorized, NotFound],
    }),
    HttpApiEndpoint.get("tags", "/tags", {
      query: { prefix: Schema.optional(Schema.String) },
      success: Schema.Array(Schema.Struct({ slug: TagSlug, lessonCount: Schema.Int })),
    }),
  )
  .middleware(Session) {}

export class ConceptsApi extends HttpApiGroup.make("concepts")
  .add(
    // The lesson-writing agent calls this before it writes a card, to reuse a concept instead.
    HttpApiEndpoint.get("search", "/concepts", {
      query: { q: Schema.optional(Schema.String), lang: Schema.optional(LessonLang) },
      success: Schema.Array(ConceptSummary),
    }),
    HttpApiEndpoint.get("get", "/concepts/:slug", {
      params: { slug: ConceptSlug },
      success: ConceptDetail,
      error: NotFound,
    }),
    // Creates the concept, or adds a version in `spec.lang`. Only its creator can change it in v1.
    HttpApiEndpoint.post("publish", "/concepts", {
      payload: ConceptSpec,
      success: ConceptDetail,
      error: [Unauthorized, Forbidden, Invalid],
    }),
  )
  .middleware(Session) {}

export class Api extends HttpApi.make("learn")
  .add(SystemApi)
  .add(MeApi)
  .add(LessonsApi)
  .add(ConceptsApi)
  .prefix("/api") {}
