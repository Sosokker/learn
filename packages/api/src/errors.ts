import { Context, type Option, Schema } from "effect"
import { HttpApiMiddleware } from "effect/http-api"
import { Issue, type UserId } from "./models.ts"

// ── Who is asking

// The signed-in user a request acts for. Only the Authenticated / Viewer middleware provides it
// (session cookie or pi's bearer token); never a header or body field. A service method that can
// read a private lesson requires it in its Effect type.
export class CurrentUser extends Context.Service<
  CurrentUser,
  { readonly id: UserId; readonly email: string; readonly name: string; readonly image: string | null }
>()("@app/api/CurrentUser") {}

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

// ── Middleware

// Requires a signed-in user (session cookie, or `Authorization: Bearer` API token for pi). For
// state-changing methods it also applies the per-user write rate limit.
export class Authenticated extends HttpApiMiddleware.Service<
  Authenticated,
  { provides: CurrentUser; requires: never }
>()("@app/api/Authenticated", { error: [Unauthenticated, CrossSiteRequest, RateLimited] }) {}

// Public reads: provides the viewer when signed in, `none` otherwise. Never fails.
export class Viewer extends HttpApiMiddleware.Service<Viewer, { provides: CurrentViewer; requires: never }>()(
  "@app/api/Viewer",
) {}

// Runs before the payload is decoded, so an oversized body is refused without buffering it all.
export class BodyLimit extends HttpApiMiddleware.Service<BodyLimit>()("@app/api/BodyLimit", {
  error: PayloadTooLarge,
}) {}
