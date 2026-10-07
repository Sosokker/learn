import { Api } from "@app/api"
import type { Translate } from "@app/ui"
import { Cause, Context, Effect, Exit, Layer, ManagedRuntime, Predicate } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"

export type Client = HttpApiClient.ForApi<typeof Api>

class ApiClient extends Context.Service<ApiClient, Client>()("learn/web/ApiClient") {}

// Same origin: the Worker serves /api next to the SPA, and the browser sends the session cookie.
const ApiClientLive = Layer.effect(
  ApiClient,
  HttpApiClient.make(Api, { baseUrl: window.location.origin }),
).pipe(Layer.provide(FetchHttpClient.layer))

const runtime = ManagedRuntime.make(ApiClientLive)

export type ApiErrorKind =
  | "NotFound"
  | "Unauthorized"
  | "Forbidden"
  | "Conflict"
  | "Invalid"
  | "Network"
  | "BadResponse"
  | "Server"
  | "RateLimited"
  | "Unknown"

export interface Issue {
  readonly path: string
  readonly message: string
}

// One error type for the UI. The typed HttpApi errors keep their tag; transport and decode
// failures are folded into Network / BadResponse / Server.
export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | undefined
  readonly issues: ReadonlyArray<Issue>
  constructor(
    kind: ApiErrorKind,
    message: string,
    options: { status?: number; issues?: ReadonlyArray<Issue> } = {},
  ) {
    super(message)
    this.name = "ApiError"
    this.kind = kind
    this.status = options.status
    this.issues = options.issues ?? []
  }
}

const statusKind = (status: number): ApiErrorKind =>
  status === 401
    ? "Unauthorized"
    : status === 403
      ? "Forbidden"
      : status === 404
        ? "NotFound"
        : status === 409
          ? "Conflict"
          : status === 422 || status === 400
            ? "Invalid"
            : status === 429
              ? "RateLimited"
              : status >= 500
                ? "Server"
                : "BadResponse"

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (Predicate.hasProperty(error, "_tag") && Predicate.isString(error._tag)) {
    const message =
      Predicate.hasProperty(error, "message") && Predicate.isString(error.message) ? error.message : ""
    switch (error._tag) {
      case "NotFound":
      case "Unauthorized":
      case "Forbidden":
      case "Conflict":
        return new ApiError(error._tag, message)
      case "TooManyRequests":
        return new ApiError("RateLimited", message)
      case "SessionError":
        return new ApiError("Unauthorized", message)
      case "Invalid": {
        const issues =
          Predicate.hasProperty(error, "issues") && Array.isArray(error.issues) ? error.issues : []
        return new ApiError("Invalid", message, { issues: issues as ReadonlyArray<Issue> })
      }
      case "SchemaError":
        return new ApiError("BadResponse", message)
      case "HttpClientError": {
        const reason = Predicate.hasProperty(error, "reason") ? error.reason : undefined
        if (Predicate.hasProperty(reason, "_tag") && reason._tag === "TransportError") {
          return new ApiError("Network", message)
        }
        const response = Predicate.hasProperty(reason, "response") ? reason.response : undefined
        const status =
          Predicate.hasProperty(response, "status") && Predicate.isNumber(response.status)
            ? response.status
            : undefined
        return status === undefined
          ? new ApiError("BadResponse", message)
          : new ApiError(statusKind(status), message, { status })
      }
    }
  }
  if (error instanceof TypeError) return new ApiError("Network", error.message)
  return new ApiError("Unknown", error instanceof Error ? error.message : String(error))
}

// Runs one client call. `signal` comes from TanStack Query so leaving a page cancels the fetch.
export async function call<A, E>(
  f: (client: Client) => Effect.Effect<A, E>,
  signal?: AbortSignal,
): Promise<A> {
  const program = Effect.gen(function* () {
    const client = yield* ApiClient
    return yield* f(client)
  })
  const exit = await runtime.runPromiseExit(program, signal ? { signal } : undefined)
  if (Exit.isSuccess(exit)) return exit.value
  throw toApiError(Cause.squash(exit.cause))
}

// Plain fetch for immutable bodies at /c/<hash>.json: no Effect client, so the edge cache key is
// the bare URL.
export async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, signal ? { signal } : {})
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e
    throw new ApiError("Network", e instanceof Error ? e.message : String(e))
  }
  if (!response.ok) {
    throw new ApiError(statusKind(response.status), `${response.status} ${url}`, { status: response.status })
  }
  try {
    return await response.json()
  } catch (e) {
    throw new ApiError("BadResponse", e instanceof Error ? e.message : String(e))
  }
}

export function errorMessage(t: Translate, error: unknown): string {
  const e = toApiError(error)
  switch (e.kind) {
    case "Network":
      return t("error.network")
    case "BadResponse":
      return t("error.badResponse")
    case "Server":
      return t("error.server", { status: e.status ?? 500 })
    case "Unauthorized":
      return t("error.unauthorized")
    case "Forbidden":
      return e.message || t("error.forbidden")
    case "NotFound":
      return t("error.notFound")
    case "Conflict":
      return e.message || t("error.conflict")
    case "Invalid":
      return e.message || t("error.invalid")
    case "RateLimited":
      return t("error.rateLimited")
    case "Unknown":
      return t("error.unknown")
  }
}
