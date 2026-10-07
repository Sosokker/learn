import { Api } from "@app/api"
import { makeAuth } from "@app/auth"
import { Db } from "@app/db"
import { Concepts, Content, Lessons, Profiles, Tokens } from "@app/services"
import { drizzle } from "drizzle-orm/d1"
import { Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import type { Env } from "./env.ts"
import { ApiHandlers, SessionLive } from "./handlers.ts"

// Everything one isolate needs, built once from its bindings: the D1 and R2 layers, the services,
// Better Auth, and the HttpApi as a fetch handler.
export function makeApp(env: Env, options: { readonly content?: Layer.Layer<Content> } = {}) {
  const db = drizzle(env.DB)
  const auth = makeAuth({
    db,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.PUBLIC_URL,
    google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
  })
  const getSession = async (headers: Headers) => {
    const s = await auth.api.getSession({ headers })
    return s === null ? null : { userId: s.user.id }
  }

  const Base = Layer.mergeAll(
    Layer.succeed(Db, Db.fromDrizzle(db)),
    options.content ?? Content.layer(env.CONTENT),
  )
  const ServicesLive = Layer.mergeAll(
    Lessons.layer.pipe(Layer.provide(Concepts.layer)),
    Concepts.layer,
    Profiles.layer,
    Tokens.layer,
  ).pipe(Layer.provideMerge(Base))

  const ApiLive = HttpApiBuilder.layer(Api).pipe(
    Layer.provide(ApiHandlers),
    Layer.provide(SessionLive(getSession)),
    Layer.provide(ServicesLive),
    Layer.provide(HttpServer.layerServices),
  )
  const { handler, dispose } = HttpRouter.toWebHandler(ApiLive, { disableLogger: true })
  return { handler: (req: Request) => handler(req), dispose, auth, services: ServicesLive }
}

export type App = ReturnType<typeof makeApp>
