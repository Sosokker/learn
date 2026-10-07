import type { UserId } from "@app/domain"
import { Context, Schema } from "effect"
import { HttpApiMiddleware } from "effect/http-api"

// Who is calling, from the Better Auth session cookie or a pi API token. Null for anonymous
// readers: most endpoints serve them too, and the services decide what they may see.
export interface ViewerInfo {
  readonly userId: UserId
}
export class Viewer extends Context.Service<Viewer, ViewerInfo | null>()("learn/api/Viewer") {}

export class SessionError extends Schema.TaggedError<SessionError>()(
  "SessionError",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

// Runs on every endpoint. It never rejects a request on its own; a bad token is treated as
// anonymous, and endpoints that need a user fail with Unauthorized.
export class Session extends HttpApiMiddleware.Service<Session, { provides: Viewer }>()("learn/api/Session", {
  error: SessionError,
}) {}
