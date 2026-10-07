import { Api, Session, Viewer } from "@app/api"
import { NotFound as NotFoundError, Unauthorized } from "@app/domain"
import { Concepts, CurrentUser, Lessons, Profiles, Tokens } from "@app/services"
import { Effect, Layer } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"

// Runs a service call that needs a signed-in user, or fails with 401.
const signedIn = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Unauthorized, Exclude<R, CurrentUser> | Viewer> =>
  Effect.gen(function* () {
    const viewer = yield* Viewer
    if (viewer === null) return yield* new Unauthorized({ message: "sign in first" })
    return yield* Effect.provideService(effect, CurrentUser, viewer)
  })

// Who is calling: a pi API token (`Authorization: Bearer lrn_…`) or the Better Auth session
// cookie. Anything else, including a bad token, is an anonymous reader.
export const SessionLive = (getSession: (headers: Headers) => Promise<{ userId: string } | null>) =>
  Layer.effect(
    Session,
    Effect.gen(function* () {
      const tokens = yield* Tokens
      return Session.of((httpEffect) =>
        Effect.gen(function* () {
          const req = yield* HttpServerRequest.HttpServerRequest
          const auth = req.headers.authorization
          const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : undefined
          const viewer =
            bearer === undefined
              ? yield* Effect.promise(() => getSession(new Headers(req.headers as Record<string, string>)))
              : yield* tokens.authenticate(bearer)
          return yield* Effect.provideService(
            httpEffect,
            Viewer,
            viewer === null ? null : { userId: viewer.userId as never },
          )
        }),
      )
    }),
  )

const SystemHandlers = HttpApiBuilder.group(
  Api,
  "system",
  Effect.fn(function* (handlers) {
    const lessons = yield* Lessons
    return handlers.handleAll({
      health: () => Effect.succeed({ ok: true }),
      categories: () =>
        Effect.map(lessons.categories(), (rows) =>
          rows.map((c) => ({ ...c, id: c.id as never, parentId: c.parentId as never })),
        ),
    })
  }),
)

const MeHandlers = HttpApiBuilder.group(
  Api,
  "me",
  Effect.fn(function* (handlers) {
    const profiles = yield* Profiles
    const tokens = yield* Tokens
    return handlers.handleAll({
      get: () => signedIn(profiles.me().pipe(Effect.catchTag("NotFound", (e) => Effect.die(e)))),
      update: ({ payload }) =>
        signedIn(profiles.update(payload).pipe(Effect.catchTag("NotFound", (e) => Effect.die(e)))),
      tokens: () => signedIn(tokens.list()),
      createToken: ({ payload }) => signedIn(tokens.create(payload.name)),
      revokeToken: ({ params }) => signedIn(tokens.revoke(params.id)),
    })
  }),
)

const LessonsHandlers = HttpApiBuilder.group(
  Api,
  "lessons",
  Effect.fn(function* (handlers) {
    const lessons = yield* Lessons
    const concepts = yield* Concepts
    return handlers.handleAll({
      feed: ({ query }) =>
        lessons.feed({
          ...query,
          categories: query.categories?.split(",").filter((c) => c !== ""),
        }),
      library: ({ query }) => signedIn(lessons.library(query.cursor)),
      byHandle: ({ params }) =>
        Effect.flatMap(Effect.service(Viewer), (v) => lessons.byHandle(v, params.handle, params.slug)),
      get: ({ params }) => Effect.flatMap(Effect.service(Viewer), (v) => lessons.byId(v, params.id)),
      body: ({ params }) =>
        Effect.flatMap(Effect.service(Viewer), (v) => lessons.body(v, params.id, params.lang)),
      concepts: ({ params }) =>
        Effect.gen(function* () {
          yield* lessons.readableVersion(yield* Viewer, params.versionId)
          return { concepts: yield* concepts.bundle(params.versionId) }
        }),
      create: ({ payload }) => signedIn(lessons.create(payload)),
      addVersion: ({ params, payload }) => signedIn(lessons.addVersion(params.id, payload)),
      update: ({ params, payload }) => signedIn(lessons.update(params.id, payload)),
      remove: ({ params }) => signedIn(lessons.remove(params.id)),
      tags: ({ query }) => lessons.tags(query.prefix),
    })
  }),
)

const ConceptsHandlers = HttpApiBuilder.group(
  Api,
  "concepts",
  Effect.fn(function* (handlers) {
    const concepts = yield* Concepts
    return handlers.handleAll({
      search: ({ query }) => concepts.search(query.q, query.lang),
      get: ({ params }) =>
        Effect.flatMap(concepts.get(params.slug), (c) =>
          c === null ? Effect.fail(new NotFoundError({ message: "concept not found" })) : Effect.succeed(c),
        ),
      publish: ({ payload }) => signedIn(concepts.publish(payload)),
    })
  }),
)

export const ApiHandlers = Layer.mergeAll(SystemHandlers, MeHandlers, LessonsHandlers, ConceptsHandlers)
