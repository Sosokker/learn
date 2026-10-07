import type { UserId } from "@app/domain"
import type { R2Bucket } from "@cloudflare/workers-types"
import { Context, Effect, Layer } from "effect"

// The signed-in user. A service function that reads or changes private data requires it in its
// type, so it cannot be called from an anonymous code path by mistake.
export class CurrentUser extends Context.Service<CurrentUser, { readonly userId: UserId }>()(
  "learn/services/CurrentUser",
) {}

// Who is reading, for endpoints that also serve anonymous readers.
export type Reader = { readonly userId: UserId } | null

export const contentKey = (hash: string) => `c/${hash}.json`

// Immutable bodies in R2, named by their sha256: `c/<hash>.json` for lessons and concepts alike.
export class Content extends Context.Service<
  Content,
  {
    readonly put: (hash: string, body: string) => Effect.Effect<void>
    readonly get: (hash: string) => Effect.Effect<string | null>
  }
>()("learn/services/Content") {
  static layer(bucket: R2Bucket): Layer.Layer<Content> {
    return Layer.succeed(
      Content,
      Content.of({
        // Same hash, same bytes: skip the write (a Class A operation) when it's already there.
        put: (hash, body) =>
          Effect.promise(async () => {
            const key = contentKey(hash)
            if ((await bucket.head(key)) !== null) return
            await bucket.put(key, body, {
              httpMetadata: {
                contentType: "application/json",
                cacheControl: "public, max-age=31536000, immutable",
              },
            })
          }),
        get: (hash) =>
          Effect.promise(async () => {
            const obj = await bucket.get(contentKey(hash))
            return obj === null ? null : await obj.text()
          }),
      }),
    )
  }

  // For tests and local tools.
  static memory(): Layer.Layer<Content> {
    const store = new Map<string, string>()
    return Layer.succeed(
      Content,
      Content.of({
        put: (hash, body) => Effect.sync(() => void store.set(contentKey(hash), body)),
        get: (hash) => Effect.sync(() => store.get(contentKey(hash)) ?? null),
      }),
    )
  }
}
