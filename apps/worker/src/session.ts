import {
  Admin,
  Authenticated,
  BodyLimit,
  CrossSiteRequest,
  CurrentAdmin,
  CurrentUser,
  CurrentViewer,
  PayloadTooLarge,
  RateLimited,
  SessionAuthenticated,
  Unauthenticated,
  UserId,
  Viewer,
} from "@app/api"
import { ApiTokens, Auth, type AuthInstance } from "@app/auth"
import { maxLessonBytes } from "@app/domain"
import { Admins } from "@app/services"
import { Effect, Layer, Option, Schema } from "effect"
import { Cookies, HttpServerRequest, HttpServerResponse } from "effect/http"
import { WriteLimit } from "./rate-limit.ts"

// Who a request acts for. A session cookie (Better Auth; with its cookieCache the session is read
// from a signed cookie for 5 minutes, so most requests touch no D1 row), or an API token in
// `Authorization: Bearer lrn_…` (ADR 0008; one indexed D1 read). When an Authorization header is
// present it is the only credential looked at, even next to a valid cookie: a client that sends a
// token means that token, and a bad one must fail rather than fall back to the browser session.

type Found = {
  readonly user: CurrentUser["Service"]
  readonly setCookies: ReadonlyArray<string>
  readonly viaToken: boolean
}

export const AuthenticatedLive = Layer.effect(
  Authenticated,
  Effect.gen(function* () {
    const authorize = yield* makeAuthorize
    return Authenticated.of(
      Effect.fn("Authenticated")(function* (httpEffect) {
        const found = yield* authorize({ acceptTokens: true })
        const response = yield* httpEffect.pipe(Effect.provideService(CurrentUser, found.user))
        return withCookies(response, found.setCookies)
      }),
    )
  }),
)

// The token endpoints: cookie only, so a leaked token cannot mint more tokens or revoke the
// owner's others.
export const SessionAuthenticatedLive = Layer.effect(
  SessionAuthenticated,
  Effect.gen(function* () {
    const authorize = yield* makeAuthorize
    return SessionAuthenticated.of(
      Effect.fn("SessionAuthenticated")(function* (httpEffect) {
        const found = yield* authorize({ acceptTokens: false })
        const response = yield* httpEffect.pipe(Effect.provideService(CurrentUser, found.user))
        return withCookies(response, found.setCookies)
      }),
    )
  }),
)

// The checks every signed-in request passes after its user is known: same-site for cookie
// requests that change state, and the per-user write budget.
const makeGuard = Effect.gen(function* () {
  const auth = yield* Auth
  const writeLimit = yield* WriteLimit
  return Effect.fn("guard")(function* (request: HttpServerRequest.HttpServerRequest, found: Found) {
    // A bearer token is never sent by the browser on its own, so another site cannot ride on it.
    const crossSite = found.viaToken
      ? undefined
      : crossSiteReason(request.method, request.headers, auth.appOrigins)
    if (crossSite !== undefined) return yield* new CrossSiteRequest({ message: crossSite })
    // Keyed by user id, which comes from the credential, so a client cannot spread its writes
    // over made-up keys; a user's tokens and sessions share one budget.
    if (!isSafeMethod(request.method) && !(yield* writeLimit.allow(found.user.id))) {
      return yield* new RateLimited({ retry_after_seconds: writeLimit.periodSeconds })
    }
  })
})

const makeAuthorize = Effect.gen(function* () {
  const auth = yield* Auth
  const tokens = yield* ApiTokens
  const guard = yield* makeGuard
  return Effect.fn("authorize")(function* (options: { readonly acceptTokens: boolean }) {
    const request = yield* HttpServerRequest.HttpServerRequest
    const bearer = bearerOf(request.headers)
    if (bearer !== undefined && !options.acceptTokens) {
      return yield* new Unauthenticated({
        message: "API tokens cannot manage tokens; sign in on the website",
      })
    }
    const found = yield* identify(auth, tokens, request, bearer)
    if (Option.isNone(found)) {
      return yield* new Unauthenticated({
        message: bearer === undefined ? "sign in first" : "invalid or revoked API token",
      })
    }
    yield* guard(request, found.value)
    return found.value
  })
})

// The admin endpoints. Session cookie only, of a user in ADMIN_USER_IDS. Anyone else, an API
// token, or no credential gets the same empty 404 as a path the router does not know, so the
// endpoints do not show that they exist. Admins then pass the usual guard.
export const AdminLive = Layer.effect(
  Admin,
  Effect.gen(function* () {
    const auth = yield* Auth
    const admins = yield* Admins
    const guard = yield* makeGuard
    return Admin.of(
      Effect.fn("Admin")(function* (httpEffect) {
        const request = yield* HttpServerRequest.HttpServerRequest
        const session = bearerOf(request.headers) === undefined ? yield* lookup(auth, request) : Option.none()
        if (Option.isNone(session) || !admins.isAdmin(session.value.user)) {
          return HttpServerResponse.empty({ status: 404 })
        }
        const found: Found = { ...session.value, viaToken: false }
        yield* guard(request, found)
        const response = yield* httpEffect.pipe(
          Effect.provideService(CurrentUser, found.user),
          Effect.provideService(CurrentAdmin, { id: found.user.id }),
        )
        return withCookies(response, found.setCookies)
      }),
    )
  }),
)

// Public reads: the viewer if signed in (cookie or token). A broken or expired cookie, or a bad
// token, reads as anonymous. Tokens are accepted so pi can read back its own private lessons.
export const ViewerLive = Layer.effect(
  Viewer,
  Effect.gen(function* () {
    const auth = yield* Auth
    const tokens = yield* ApiTokens
    return Viewer.of(
      Effect.fn("Viewer")(function* (httpEffect) {
        const request = yield* HttpServerRequest.HttpServerRequest
        const found = yield* identify(auth, tokens, request, bearerOf(request.headers))
        const response = yield* httpEffect.pipe(
          Effect.provideService(
            CurrentViewer,
            Option.map(found, (value) => value.user),
          ),
        )
        return Option.match(found, {
          onNone: () => response,
          onSome: (value) => withCookies(response, value.setCookies),
        })
      }),
    )
  }),
)

// The token of an Authorization header: `Bearer <token>` (scheme case-insensitive). Any other
// Authorization value yields "" so it fails verification instead of being ignored.
const bearerOf = (headers: Readonly<Record<string, string | undefined>>): string | undefined => {
  const header = headers.authorization
  if (header === undefined) return undefined
  return /^Bearer +(\S+)$/i.exec(header.trim())?.[1] ?? ""
}

const identify = (
  auth: Auth["Service"],
  tokens: ApiTokens["Service"],
  request: HttpServerRequest.HttpServerRequest,
  bearer: string | undefined,
): Effect.Effect<Option.Option<Found>> =>
  bearer === undefined
    ? lookup(auth, request).pipe(Effect.map(Option.map((session) => ({ ...session, viaToken: false }))))
    : tokens.verify(bearer).pipe(Effect.map(Option.map((user) => ({ user, setCookies: [], viaToken: true }))))

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
                    viaToken: false,
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
