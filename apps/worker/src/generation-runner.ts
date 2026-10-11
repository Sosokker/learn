import type { GenerationId } from "@app/api"
import { GenerationRunner } from "@app/services"
import { Effect, Layer } from "effect"

// The GenerationRunner seam on Durable Objects: one GenerationAgent per job, named by the job id.
// Without the binding (a setup that lacks it), jobs fail to start and say so.
export const GenerationRunnerDO = (namespace: DurableObjectNamespace | undefined) =>
  Layer.succeed(
    GenerationRunner,
    GenerationRunner.of({
      start: Effect.fn("GenerationRunner.start")(function* (id: GenerationId) {
        if (namespace === undefined) return false
        const response = yield* Effect.tryPromise(() =>
          stub(namespace, id).fetch("https://generation/start", { method: "POST", body: id }),
        ).pipe(Effect.option)
        return response._tag === "Some" && response.value.ok
      }),
      cancel: Effect.fn("GenerationRunner.cancel")(function* (id: GenerationId) {
        if (namespace === undefined) return
        yield* Effect.tryPromise(() =>
          stub(namespace, id).fetch("https://generation/cancel", { method: "POST" }),
        ).pipe(Effect.ignore)
      }),
      events: Effect.fn("GenerationRunner.events")(function* (id: GenerationId, after: number) {
        if (namespace === undefined) return new Response(null, { status: 503 })
        const response = yield* Effect.promise(() =>
          stub(namespace, id).fetch(`https://generation/events?after=${after}`),
        )
        // A copy with mutable headers: the HTTP layer adds its own.
        return new Response(response.body, {
          status: response.status,
          headers: new Headers(response.headers),
        })
      }),
    }),
  )

const stub = (namespace: DurableObjectNamespace, id: GenerationId) => namespace.get(namespace.idFromName(id))
