import { apiOf, defaultBaseUrls, type ModelApi, type ModelEntry } from "@app/services"
import type { StreamFn } from "@earendil-works/pi-agent-core"
import type { Api, Model } from "@earendil-works/pi-ai"
import { streamSimple as anthropicMessages } from "@earendil-works/pi-ai/api/anthropic-messages"
import { streamSimple as openaiCompletions } from "@earendil-works/pi-ai/api/openai-completions"

// pi-ai's package root exports no provider streams, and its model catalog would bundle every
// provider. So each model is built by hand from its GENERATION_MODELS entry, and its stream module
// is picked here: one import per API we use.

const build = <A extends ModelApi>(entry: ModelEntry, api: A): Model<A> => ({
  id: entry.model,
  name: entry.label,
  api,
  provider: entry.provider,
  baseUrl: entry.base_url ?? defaultBaseUrls[entry.provider],
  input: ["text"],
  // No extended thinking: the lesson is written in tool calls, and thinking tokens cost output.
  // This only stops pi from asking for it. OpenAI reasoning models (GPT-6 Luna) still reason at
  // their default effort, and those tokens count as output: toward the job's output budget
  // (GENERATION_MAX_OUTPUT_TOKENS) and its cost.
  reasoning: false,
  // pi's own cost estimate; the job's cost comes from costOf (run.ts), which knows 1-hour writes.
  cost: {
    input: entry.cost.input,
    output: entry.cost.output,
    cacheRead: entry.cost.cache_read,
    cacheWrite: entry.cost.cache_write,
  },
  contextWindow: entry.context_window,
  maxTokens: entry.max_tokens,
})

// The pi model of an entry and the stream that serves it. A job never switches model, so the
// stream ignores the model the loop hands back and uses its own, typed for its API.
export const piModelOf = (entry: ModelEntry): { readonly model: Model<Api>; readonly stream: StreamFn } => {
  if (apiOf(entry) === "anthropic-messages") {
    const model = build(entry, "anthropic-messages")
    return { model, stream: (_model, context, options) => anthropicMessages(model, context, options) }
  }
  const model: Model<"openai-completions"> = {
    ...build(entry, "openai-completions"),
    // pi sends `prompt_cache_retention: "24h"` (and, off api.openai.com, `prompt_cache_key`) for a
    // long retention unless told not to. DeepSeek documents neither and caches on its own; on
    // OpenAI only some models take 24h. So never: OpenAI still gets prompt_cache_key (pi sends it
    // to api.openai.com for any retention) and its default in-memory cache.
    compat: { supportsLongCacheRetention: false },
  }
  return { model, stream: (_model, context, options) => openaiCompletions(model, context, options) }
}
