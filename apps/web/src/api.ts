import { Api } from "@app/api"
import { Context, type Effect, Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"

// The typed client for the Worker's HttpApi (packages/api). Same origin as the Worker, so the
// browser sends the Better Auth session cookie with every call.
export class ApiClient extends Context.Service<ApiClient, HttpApiClient.ForApi<typeof Api>>()(
  "@app/web/ApiClient",
) {
  static readonly layer = Layer.effect(
    ApiClient,
    HttpApiClient.make(Api, { baseUrl: window.location.origin }),
  ).pipe(Layer.provide(FetchHttpClient.layer))
}

const runtime = ManagedRuntime.make(ApiClient.layer)

// Bridge for TanStack Query: queryFn / mutationFn get a Promise typed by the shared HttpApi. A
// declared refusal rejects with the error value itself (its `_tag` says which one). Pass the
// query's `signal` so a replaced query aborts its request.
export const callApi = <A, E>(
  f: (client: ApiClient["Service"]) => Effect.Effect<A, E>,
  signal?: AbortSignal,
) => runtime.runPromise(ApiClient.use(f), signal === undefined ? undefined : { signal })

// The `_tag` of a rejection from callApi ("LessonNotFound", "InvalidLesson", …), or "".
export function errorTag(error: unknown): string {
  return typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"
    ? error._tag
    : ""
}
