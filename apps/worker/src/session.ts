import {
  Authenticated,
  BodyLimit,
  CrossSiteRequest,
  CurrentUser,
  CurrentViewer,
  PayloadTooLarge,
  RateLimited,
  Unauthenticated,
  UserId,
  Viewer,
} from "@app/api"
import { Auth, type AuthInstance } from "@app/auth"
import { maxLessonBytes } from "@app/domain"
import { Effect, Layer, Option, Schema } from "effect"
import { Cookies, HttpServerRequest, HttpServerResponse } from "effect/http"
import { WriteLimit } from "./rate-limit.ts"

// Session cookie -> user, on every request that needs one. With Better Auth's cookieCache the
// session is read from a signed cookie for 5 minutes, so most requests touch no D1 row.

export const AuthenticatedLive = Layer.effect(
  Authenticated,
  Effect.gen(function* () {
    const auth = yield* Auth
    const writeLimit = yield* WriteLimit
    return Authenticated.of(
      Effect.fn("Authenticated")(function* (httpEffect) {
        const request = yield* HttpServerRequest.HttpServerRequest
        const session = yield* lookup(auth, request)
        if (Option.isNone(session)) return yield* new Unauthenticated({ message: "sign in first" })
        const crossSite = crossSiteReason(request.method, request.headers, auth.appOrigins)
        if (crossSite !== undefined) return yield* new CrossSiteRequest({ message: crossSite })
        // Keyed by user id, which comes from the session, so a client cannot spread its writes
        // over made-up keys.
        if (!isSafeMethod(request.method) && !(yield* writeLimit.allow(session.value.user.id))) {
          return yield* new RateLimited({ retry_after_seconds: writeLimit.periodSeconds })
        }
        const response = yield* httpEffect.pipe(Effect.provideService(CurrentUser, session.value.user))
        return withCookies(response, session.value.setCookies)
      }),
    )
  }),
)

// Public reads: the viewer if signed in. A broken or expired cookie reads as anonymous.
export const ViewerLive = Layer.effect(
  Viewer,
  Effect.gen(function* () {
    const auth = yield* Auth
    return Viewer.of(
      Effect.fn("Viewer")(function* (httpEffect) {
        const request = yield* HttpServerRequest.HttpServerRequest
        const session = yield* lookup(auth, request)
        const response = yield* httpEffect.pipe(
          Effect.provideService(
            CurrentViewer,
            Option.map(session, (found) => found.user),
          ),
        )
        return Option.match(session, {
          onNone: () => response,
          onSome: (found) => withCookies(response, found.setCookies),
        })
      }),
    )
  }),
)

// effect 4.0.1's MaxBodySize only bounds multipart bodies, so JSON uploads are checked here.
// Content-Length rejects early; without it, the body is read (the request caches it, so payload
// decoding reuses the buffer) and measured.
export const BodyLimitLive = Layer.succeed(
  BodyLimit,
  BodyLimit.of(
    Effect.fn("BodyLimit")(function* (httpEffect) {
      const request = yield* HttpServerRequest.HttpServerRequest
      const declared = request.headers["content-length"]
      const size =
        declared === undefined ? (yield* request.arrayBuffer.pipe(Effect.orDie)).byteLength : Number(declared)
      // Negated so a malformed Content-Length (NaN) is refused too.
      if (!(size <= maxLessonBytes)) return yield* new PayloadTooLarge({ max_bytes: maxLessonBytes })
      return yield* httpEffect
    }),
  ),
)

const lookup = (auth: Auth["Service"], request: HttpServerRequest.HttpServerRequest) =>
  auth
    .use((instance) => sessionOf(instance, new Headers(request.headers)))
    .pipe(
      Effect.flatMap((found) =>
        found === undefined
          ? Effect.succeed(Option.none())
          : Schema.decodeUnknownEffect(UserId)(found.user.id).pipe(
              Effect.map((id) =>
                Option.some({
                  user: {
                    id,
                    email: found.user.email,
                    name: found.user.name,
                    image: found.user.image ?? null,
                  },
                  setCookies: found.setCookies,
                }),
              ),
            ),
      ),
      // A Better Auth or D1 failure here is a 500, not a silent sign-out.
      Effect.orDie,
    )

async function sessionOf(auth: AuthInstance, headers: Headers) {
  const result = await auth.api.getSession({ headers, returnHeaders: true })
  if (result.response === null) return undefined
  return { user: result.response.user, setCookies: result.headers.getSetCookie() }
}

// getSession may extend the session and re-issue its cookie; pass it on, or the browser keeps the
// old expiry.
const withCookies = (response: HttpServerResponse.HttpServerResponse, setCookies: ReadonlyArray<string>) =>
  setCookies.length === 0
    ? response
    : HttpServerResponse.mergeCookies(response, Cookies.fromSetCookie(setCookies))

const safeMethods = ["GET", "HEAD", "OPTIONS"]
const isSafeMethod = (method: string) => safeMethods.includes(method.toUpperCase())

// Why a session request must be refused as cross-site, if it must. The cookie is SameSite=Lax,
// which still sends it from sibling subdomains of sirin.dev; browsers send Origin on every
// state-changing fetch and Sec-Fetch-Site on all of them. A request with neither is not from a
// browser, so it carries no ambient cookie to abuse.
function crossSiteReason(
  method: string,
  headers: Readonly<Record<string, string | undefined>>,
  appOrigins: ReadonlyArray<string>,
) {
  if (isSafeMethod(method)) return undefined
  const fetchSite = headers["sec-fetch-site"]
  if (fetchSite === "cross-site" || fetchSite === "same-site") return `refused a ${fetchSite} request`
  const origin = headers.origin
  if (origin !== undefined && !appOrigins.includes(origin)) return "refused a request from another origin"
  return undefined
}
