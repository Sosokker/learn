import { Context, type Option, Schema } from "effect"
import { HttpApiMiddleware } from "effect/http-api"
import { Issue, type UserId } from "./models.ts"

// ── Who is asking

// The signed-in user a request acts for. Only the Authenticated / Viewer middleware provides it
// (session cookie or pi's bearer token); never a header or body field. A service method that can
// read a private lesson requires it in its Effect type. `viaToken` says how the request signed in:
// admin powers (ADMIN_USER_IDS) need a session cookie, so a leaked API token never carries them.
export class CurrentUser extends Context.Service<
  CurrentUser,
  {
    readonly id: UserId
    readonly email: string
    readonly name: string
    readonly image: string | null
    readonly viaToken: boolean
  }
>()("@app/api/CurrentUser") {}

// An admin (the Worker's ADMIN_USER_IDS). Only the Admin middleware provides it, so a service
// method that needs it cannot run for anyone else.
export class CurrentAdmin extends Context.Service<CurrentAdmin, { readonly id: UserId }>()(
  "@app/api/CurrentAdmin",
) {}

// The reader of a public endpoint: signed in or anonymous.
export class CurrentViewer extends Context.Service<CurrentViewer, Option.Option<CurrentUser["Service"]>>()(
  "@app/api/CurrentViewer",
) {}

// ── Errors. Status codes are declared here so the typed client gets typed errors.

export class Unauthenticated extends Schema.TaggedError<Unauthenticated>()(
  "Unauthenticated",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

// A state-changing request sent by a page on another site (see apps/worker/src/session.ts).
export class CrossSiteRequest extends Schema.TaggedError<CrossSiteRequest>()(
  "CrossSiteRequest",
  { message: Schema.String },
  { httpApiStatus: 403 },
) {}

// Missing, deleted, or private and not yours: the same 404, so a private lesson's existence
// does not leak.
export class LessonNotFound extends Schema.TaggedError<LessonNotFound>()(
  "LessonNotFound",
  {},
  { httpApiStatus: 404 },
) {}

export class VersionNotFound extends Schema.TaggedError<VersionNotFound>()(
  "VersionNotFound",
  {},
  { httpApiStatus: 404 },
) {}

export class ConceptNotFound extends Schema.TaggedError<ConceptNotFound>()(
  "ConceptNotFound",
  { slug: Schema.String },
  { httpApiStatus: 404 },
) {}

export class CategoryNotFound extends Schema.TaggedError<CategoryNotFound>()(
  "CategoryNotFound",
  {},
  { httpApiStatus: 404 },
) {}

// A feed filter (or filter + sort) that no index covers, so it would scan rows. See Feeds in
// packages/services.
export class UnsupportedFilter extends Schema.TaggedError<UnsupportedFilter>()(
  "UnsupportedFilter",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

export class PayloadTooLarge extends Schema.TaggedError<PayloadTooLarge>()(
  "PayloadTooLarge",
  { max_bytes: Schema.Int },
  { httpApiStatus: 413 },
) {}

// The body is not JSON, fails the LessonSpec schema, or fails the shared validator (references,
// expressions, en/th parity, unknown concepts).
export class InvalidLesson extends Schema.TaggedError<InvalidLesson>()(
  "InvalidLesson",
  { issues: Schema.Array(Issue) },
  { httpApiStatus: 422 },
) {}

export class InvalidConcept extends Schema.TaggedError<InvalidConcept>()(
  "InvalidConcept",
  { issues: Schema.Array(Issue) },
  { httpApiStatus: 422 },
) {}

// A lesson setting that breaks a rule: public needs a category, ≥ 1 tag and a published version;
// an unknown category; a tag that normalizes to nothing.
export class InvalidSettings extends Schema.TaggedError<InvalidSettings>()(
  "InvalidSettings",
  { message: Schema.String },
  { httpApiStatus: 422 },
) {}

// Concepts are public and shared: only the one who created a concept adds versions to it.
export class ConceptForbidden extends Schema.TaggedError<ConceptForbidden>()(
  "ConceptForbidden",
  { message: Schema.String },
  { httpApiStatus: 403 },
) {}

// A handle that is reserved (see reservedHandles).
export class InvalidHandle extends Schema.TaggedError<InvalidHandle>()(
  "InvalidHandle",
  { message: Schema.String },
  { httpApiStatus: 422 },
) {}

export class HandleTaken extends Schema.TaggedError<HandleTaken>()(
  "HandleTaken",
  { handle: Schema.String },
  { httpApiStatus: 409 },
) {}

// Too many state-changing requests from one user in a short time (Workers Rate Limiting).
export class RateLimited extends Schema.TaggedError<RateLimited>()(
  "RateLimited",
  { retry_after_seconds: Schema.Int },
  { httpApiStatus: 429 },
) {}

export class ApiTokenNotFound extends Schema.TaggedError<ApiTokenNotFound>()(
  "ApiTokenNotFound",
  {},
  { httpApiStatus: 404 },
) {}

// The user already has `max` active API tokens.
export class ApiTokenLimit extends Schema.TaggedError<ApiTokenLimit>()(
  "ApiTokenLimit",
  { max: Schema.Int },
  { httpApiStatus: 409 },
) {}

// Missing, deleted, not visible to you, or not yours to change: the same 404.
export class CommentNotFound extends Schema.TaggedError<CommentNotFound>()(
  "CommentNotFound",
  {},
  { httpApiStatus: 404 },
) {}

// A reply to a reply, to a deleted or hidden comment, or past maxReplies.
export class InvalidComment extends Schema.TaggedError<InvalidComment>()(
  "InvalidComment",
  { message: Schema.String },
  { httpApiStatus: 422 },
) {}

export class ReportNotFound extends Schema.TaggedError<ReportNotFound>()(
  "ReportNotFound",
  {},
  { httpApiStatus: 404 },
) {}

// ── AI lesson generation

// Missing, or another user's job: the same 404.
export class GenerationNotFound extends Schema.TaggedError<GenerationNotFound>()(
  "GenerationNotFound",
  {},
  { httpApiStatus: 404 },
) {}

// An unknown model, or BYOK billing for a model that takes no user key.
export class InvalidGeneration extends Schema.TaggedError<InvalidGeneration>()(
  "InvalidGeneration",
  { message: Schema.String },
  { httpApiStatus: 422 },
) {}

// Platform billing for a model whose provider has no platform key: only the user's own key can
// pay for it. (At launch no provider has one, so every model is BYOK-only.)
export class PlatformBillingUnavailable extends Schema.TaggedError<PlatformBillingUnavailable>()(
  "PlatformBillingUnavailable",
  { model: Schema.String },
  { httpApiStatus: 422 },
) {}

// AI generation is switched off because its server settings are broken (a bad BYOK_KEK or
// GENERATION_MODELS). The rest of the API keeps working; the Worker logs the reason once.
export class GenerationUnavailable extends Schema.TaggedError<GenerationUnavailable>()(
  "GenerationUnavailable",
  {},
  { httpApiStatus: 503 },
) {}

// Today's platform-paid jobs are used up. A job billed to the user's own key is still possible.
export class GenerationQuotaExceeded extends Schema.TaggedError<GenerationQuotaExceeded>()(
  "GenerationQuotaExceeded",
  { limit: Schema.Int, resets_at: Schema.Int },
  { httpApiStatus: 429 },
) {}

// The user already has a job queued or running (one at a time).
export class GenerationBusy extends Schema.TaggedError<GenerationBusy>()(
  "GenerationBusy",
  {},
  { httpApiStatus: 409 },
) {}

// BYOK billing for a provider the user has stored no key for.
export class ByokKeyMissing extends Schema.TaggedError<ByokKeyMissing>()(
  "ByokKeyMissing",
  { provider: Schema.String },
  { httpApiStatus: 422 },
) {}

export class ByokKeyNotFound extends Schema.TaggedError<ByokKeyNotFound>()(
  "ByokKeyNotFound",
  {},
  { httpApiStatus: 404 },
) {}

// A key that does not look like one of the provider's API keys.
export class InvalidByokKey extends Schema.TaggedError<InvalidByokKey>()(
  "InvalidByokKey",
  { message: Schema.String },
  { httpApiStatus: 422 },
) {}

// The server has no BYOK_KEK, so it cannot store keys.
export class ByokUnavailable extends Schema.TaggedError<ByokUnavailable>()(
  "ByokUnavailable",
  {},
  { httpApiStatus: 503 },
) {}

// ── Middleware

// Requires a signed-in user: a session cookie, or an `Authorization: Bearer lrn_…` API token
// (pi, scripts/publish.ts). When an Authorization header is present it is the only credential
// looked at. Cookie requests that change state must come from the app's origin; bearer requests
// carry no ambient credential, so they skip that check. Both get the per-user write rate limit.
export class Authenticated extends HttpApiMiddleware.Service<
  Authenticated,
  { provides: CurrentUser; requires: never }
>()("@app/api/Authenticated", { error: [Unauthenticated, CrossSiteRequest, RateLimited] }) {}

// Session cookie only: an API token is refused (401), so a leaked token cannot mint, list or
// revoke tokens. Same origin check and write limit as Authenticated.
export class SessionAuthenticated extends HttpApiMiddleware.Service<
  SessionAuthenticated,
  { provides: CurrentUser; requires: never }
>()("@app/api/SessionAuthenticated", { error: [Unauthenticated, CrossSiteRequest, RateLimited] }) {}

// Public reads: provides the viewer when signed in (cookie or API token, as Authenticated),
// `none` otherwise. Never fails: a bad credential reads as anonymous.
export class Viewer extends HttpApiMiddleware.Service<Viewer, { provides: CurrentViewer; requires: never }>()(
  "@app/api/Viewer",
) {}

// Runs before the payload is decoded, so an oversized body is refused without buffering it all.
export class BodyLimit extends HttpApiMiddleware.Service<BodyLimit>()("@app/api/BodyLimit", {
  error: PayloadTooLarge,
}) {}

// The admin endpoints: a session cookie (never an API token) of a user in ADMIN_USER_IDS.
// Anyone else, signed in or not, gets the router's plain 404, as for a path that does not exist.
export class Admin extends HttpApiMiddleware.Service<
  Admin,
  { provides: CurrentUser | CurrentAdmin; requires: never }
>()("@app/api/Admin", { error: [CrossSiteRequest, RateLimited] }) {}
