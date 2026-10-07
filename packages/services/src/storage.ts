import { Context, type Effect, type Option, Schema } from "effect"

export class StorageError extends Schema.TaggedError<StorageError>()("StorageError", {
  cause: Schema.Defect(),
}) {}

export interface StoredObject {
  readonly body: Uint8Array
  readonly contentType: string
}

// Platform seam for object storage. Production: the R2 layer in apps/worker. Web-standard types
// only, so it can be backed by any object store. Bodies here are small (≤ 512 KB lesson specs), so
// reads return the whole body rather than a stream.
export class Storage extends Context.Service<
  Storage,
  {
    readonly put: (key: string, object: StoredObject) => Effect.Effect<void, StorageError>
    readonly get: (key: string) => Effect.Effect<Option.Option<StoredObject>, StorageError>
    readonly exists: (key: string) => Effect.Effect<boolean, StorageError>
  }
>()("@app/services/Storage") {}
