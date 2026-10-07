import { Api, ConceptBundle, CurrentUser, CurrentViewer, NotReady } from "@app/api"
import { Auth } from "@app/auth"
import { Database } from "@app/db"
import {
  Categories,
  Concepts,
  ContentAccess,
  Feeds,
  HotScore,
  type LessonReads,
  Lessons,
  Profiles,
} from "@app/services"
import { Effect, Layer, Option, Schema } from "effect"
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { AuthenticatedLive, BodyLimitLive, ViewerLive } from "./session.ts"

const SystemHandlers = HttpApiBuilder.group(
  Api,
  "system",
  Effect.fn("SystemHandlers")(function* (handlers) {
    const db = yield* Database
    return handlers
      .handle("health", () => Effect.succeed({ status: "ok" as const }))
      .handle("ready", () =>
        db.ready.pipe(
          Effect.as({ status: "ok" as const }),
          Effect.catchTag("SqlError", (error) =>
            Effect.logError("database not ready", error).pipe(Effect.andThen(Effect.fail(new NotReady()))),
          ),
        ),
      )
  }),
)

const MeHandlers = HttpApiBuilder.group(
  Api,
  "me",
  Effect.fn("MeHandlers")(function* (handlers) {
    const profiles = yield* Profiles
    return handlers
      .handle("get", () => profiles.me)
      .handle("update", (request) => profiles.setHandle(request.payload.handle))
  }),
)

const CategoriesHandlers = HttpApiBuilder.group(
  Api,
  "categories",
  Effect.fn("CategoriesHandlers")(function* (handlers) {
    const categories = yield* Categories
    return handlers.handle("list", () => categories.list)
  }),
)

const LessonsHandlers = HttpApiBuilder.group(
  Api,
  "lessons",
  Effect.fn("LessonsHandlers")(function* (handlers) {
    const lessons = yield* Lessons
    // Anonymous readers get the reads that cannot see private lessons; signed-in readers get the
    // ones that require CurrentUser (and see their own private lessons).
    const asViewer = <A, E>(run: <R>(reads: LessonReads<R>) => Effect.Effect<A, E, R>) =>
      Effect.flatMap(Effect.service(CurrentViewer), (viewer) =>
        Option.match(viewer, {
          onNone: () => run(lessons.anonymous),
          onSome: (user) => run(lessons.asUser).pipe(Effect.provideService(CurrentUser, user)),
        }),
      )
    return (
      handlers
        .handle("get", (request) => asViewer((reads) => reads.get(request.params.id)))
        .handle("getBySlug", (request) =>
          asViewer((reads) => reads.getBySlug(request.params.handle, request.params.slug)),
        )
        .handle("versions", (request) =>
          asViewer((reads) => reads.versions(request.params.id, request.query.lang)),
        )
        // Raw: the stored bytes go out as they are (no re-encoding of up to 512 KB), never cached,
        // because the body may be private.
        .handleRaw("body", (request) =>
          asViewer((reads) => reads.body(request.params.id, request.params.versionId)).pipe(
            Effect.map((bytes) =>
              HttpServerResponse.uint8Array(bytes, {
                contentType: "application/json",
                headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
              }),
            ),
          ),
        )
        // Raw, for the cache header: a version's pins never change, so the bundle of a public or
        // unlisted lesson is cacheable like `/c/` (worker.ts also keeps it in the edge cache). A
        // private lesson's bundle is never stored.
        .handleRaw("concepts", (request) =>
          asViewer((reads) => reads.concepts(request.params.id, request.params.versionId)).pipe(
            Effect.flatMap(({ bundle, shared }) =>
              Schema.encodeEffect(ConceptBundle)(bundle).pipe(
                Effect.flatMap((encoded) =>
                  HttpServerResponse.json(encoded, {
                    headers: {
                      "cache-control": shared ? immutableCache : "private, no-store",
                      "x-content-type-options": "nosniff",
                    },
                  }),
                ),
                Effect.orDie,
              ),
            ),
          ),
        )
        .handle("update", (request) => lessons.update(request.params.id, request.payload))
        .handle("delete", (request) => lessons.remove(request.params.id))
        .handle("mine", (request) =>
          lessons.mine({ cursor: request.query.cursor, limit: request.query.limit }),
        )
        .handle("publish", (request) => lessons.publish(request.params.slug, request.payload))
    )
  }),
)

const FeedsHandlers = HttpApiBuilder.group(
  Api,
  "feeds",
  Effect.fn("FeedsHandlers")(function* (handlers) {
    const feeds = yield* Feeds
    return handlers
      .handle("new", (request) => feeds.latest(request.query))
      .handle("category", (request) => feeds.category(request.params.id, request.query))
      .handle("tag", (request) => feeds.tag(request.params.slug, request.query))
  }),
)

const ConceptsHandlers = HttpApiBuilder.group(
  Api,
  "concepts",
  Effect.fn("ConceptsHandlers")(function* (handlers) {
    const concepts = yield* Concepts
    return handlers
      .handle("search", (request) => concepts.search(request.query))
      .handle("get", (request) => concepts.get(request.params.slug))
      .handle("publish", (request) => concepts.publish(request.payload))
  }),
)

// Better Auth owns /api/auth/* (Google sign-in, callback, session, sign-out). The specific route
// wins over the HttpApi routes, which never use that prefix.
const AuthRoutes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const auth = yield* Auth
    yield* router.add("*", "/api/auth/*", (request) =>
      HttpServerRequest.toWeb(request).pipe(
        Effect.flatMap((web) => auth.use((instance) => instance.handler(web))),
        Effect.map(HttpServerResponse.fromWeb),
        Effect.orDie,
      ),
    )
  }),
)

// `/c/<sha256>.json`: an immutable body, for public and unlisted lessons and for concepts (see
// ContentAccess). Cached for a year by browsers and, through the Cache API in worker.ts, the edge.
const ContentRoutes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const content = yield* ContentAccess
    yield* router.add("GET", "/c/*", (request) =>
      Effect.gen(function* () {
        const match = /^\/c\/([0-9a-f]{64})\.json$/.exec(new URL(request.url, "http://localhost").pathname)
        const body = match?.[1] === undefined ? Option.none() : yield* content.publicBody(match[1])
        return Option.match(body, {
          onNone: () =>
            HttpServerResponse.text("not found", { status: 404, headers: { "cache-control": "no-store" } }),
          onSome: (object) =>
            HttpServerResponse.uint8Array(object.body, {
              contentType: "application/json",
              headers: {
                "cache-control": immutableCache,
                "x-content-type-options": "nosniff",
                "access-control-allow-origin": "*",
              },
            }),
        })
      }),
    )
  }),
)

const immutableCache = "public, max-age=31536000, immutable"

// Handlers plus everything they need except the platform (D1, Storage) and config. Tests build
// the same layer on Miniflare's D1 and R2.
export const HandlersLive = Layer.mergeAll(
  SystemHandlers,
  MeHandlers,
  CategoriesHandlers,
  LessonsHandlers,
  FeedsHandlers,
  ConceptsHandlers,
).pipe(
  Layer.provide(Layer.mergeAll(Lessons.layer, Concepts.layer, Feeds.layer, Categories.layer, Profiles.layer)),
  Layer.provideMerge(Layer.mergeAll(AuthenticatedLive, ViewerLive, BodyLimitLive)),
  Layer.provideMerge(Layer.mergeAll(ContentAccess.layer, HotScore.layer)),
  Layer.provideMerge(Auth.layer),
  Layer.provideMerge(Database.layer),
)

// The HttpApi routes, Better Auth's /api/auth/*, and /c/.
export const ApiLive = Layer.mergeAll(
  HttpApiBuilder.layer(Api, { openapiPath: "/api/openapi.json" }),
  AuthRoutes,
  ContentRoutes,
  RedactedHeaders(),
).pipe(Layer.provide(HandlersLive))

// The tracer records request headers as span attributes except these.
function RedactedHeaders() {
  return Layer.succeed(Headers.CurrentRedactedNames, ["authorization", "cookie", "set-cookie"])
}
