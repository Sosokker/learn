import { Storage, StorageError } from "@app/services"
import { Effect, Layer, Option } from "effect"

// The Storage seam on R2. Content-Type travels as httpMetadata so objects stay self-describing.
export const StorageR2 = (bucket: R2Bucket) =>
  Layer.succeed(
    Storage,
    Storage.of({
      put: Effect.fn("Storage.put")(function* (key, object) {
        yield* Effect.tryPromise({
          try: () => bucket.put(key, object.body, { httpMetadata: { contentType: object.contentType } }),
          catch: (cause) => new StorageError({ cause }),
        })
      }),
      get: Effect.fn("Storage.get")(function* (key) {
        const stored = yield* Effect.tryPromise({
          try: async () => {
            const object = await bucket.get(key)
            if (object === null) return undefined
            return {
              body: new Uint8Array(await object.arrayBuffer()),
              contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
            }
          },
          catch: (cause) => new StorageError({ cause }),
        })
        return Option.fromNullishOr(stored)
      }),
      exists: Effect.fn("Storage.exists")(function* (key) {
        const head = yield* Effect.tryPromise({
          try: () => bucket.head(key),
          catch: (cause) => new StorageError({ cause }),
        })
        return head !== null
      }),
    }),
  )
