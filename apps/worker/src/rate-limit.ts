import { Context, Effect, Layer } from "effect"

// Matches `simple.period` of WRITE_LIMIT in wrangler.jsonc.
const periodSeconds = 60

// The per-user budget for state-changing requests (publish, concept publish, PATCH, DELETE),
// checked by the Authenticated middleware after the session is known. In production it is the
// Workers Rate Limiting binding WRITE_LIMIT (wrangler.jsonc `ratelimits`); without the binding
// (tests, a local setup that lacks it) every request is allowed.
export class WriteLimit extends Context.Service<
  WriteLimit,
  {
    // True when the request may go ahead.
    readonly allow: (userId: string) => Effect.Effect<boolean>
    // The binding's period, sent back with a 429.
    readonly periodSeconds: number
  }
>()("@app/worker/WriteLimit") {
  static readonly unlimited = Layer.succeed(
    WriteLimit,
    WriteLimit.of({ allow: () => Effect.succeed(true), periodSeconds }),
  )

  static readonly fromBinding = (binding: RateLimit | undefined) =>
    binding === undefined
      ? WriteLimit.unlimited
      : Layer.succeed(
          WriteLimit,
          WriteLimit.of({
            allow: (userId) =>
              Effect.tryPromise({ try: () => binding.limit({ key: userId }), catch: (cause) => cause }).pipe(
                Effect.map((outcome) => outcome.success),
                // The limiter is a guard, not a dependency: if it fails, let the request through.
                Effect.catch((cause) =>
                  Effect.logWarning("write rate limiter failed; allowing", cause).pipe(Effect.as(true)),
                ),
              ),
            periodSeconds,
          }),
        )
}
