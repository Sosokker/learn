import { checkLesson, lessonJsonSchema } from "@app/domain"
import type { ModelEntry } from "@app/services"
import { normalizeContext, type Usage } from "@earendil-works/pi-ai"
import { describe, expect, it } from "vitest"
import guide from "../../../content/guide/en.json"
import { fakeProvider, tinyLesson } from "../src/fake-provider.ts"
import { piModelOf } from "../src/models.ts"
import { systemPrompt, userPrompt } from "../src/prompt.ts"
import { costOf, draftSlug, providerError, shortTail } from "../src/run.ts"
import { makeTools } from "../src/tools.ts"

const noop = () => Promise.reject(new Error("not called"))
const tools = () =>
  JSON.stringify(
    makeTools({ searchConcepts: noop, getConcept: noop, validateLesson: noop, saveDraft: noop }).map(
      (tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }),
    ),
  )

describe("the cached prompt prefix", () => {
  it("is the same bytes every time: no dates, users or ids", () => {
    expect(tools()).toBe(tools())
    expect(systemPrompt).not.toMatch(/\b20\d\d-\d\d-\d\d\b/u)
    expect(systemPrompt).toContain(JSON.stringify(lessonJsonSchema().schema))
    expect(systemPrompt).toContain(JSON.stringify(guide))
    // The job's text goes in the user message, after the prefix.
    expect(userPrompt("Ohm's law", "th")).toContain('"lang": "th"')
  })

  it("teaches from a valid example", () => {
    expect(checkLesson(guide).issues).toEqual([])
  })

  it("never lets a tool take a user, owner or lesson id", () => {
    expect(tools()).not.toMatch(/user_id|owner|lesson_id/u)
    expect(tools()).toContain('"additionalProperties":false')
  })
})

describe("drafts", () => {
  it("slugs from the title's Latin words and the job id", () => {
    const id = "01a1296d-fb80-727e-8235-2c115473f8d0"
    expect(draftSlug("Ohm's Law: V = IR", id)).toBe("ohm-s-law-v-ir-73f8d0")
    expect(draftSlug("กฎของโอห์ม", id)).toBe("lesson-73f8d0")
    expect(draftSlug("x".repeat(200), id)).toMatch(/^x{60}-73f8d0$/u)
  })

  it("the fake model's lesson is valid, and its broken draft has one issue", () => {
    for (const lang of ["en", "th"] as const) {
      const state = { topic: "A [weird] $topic$ with *markup*", lang }
      expect(checkLesson(tinyLesson(state)).issues).toEqual([])
      expect(checkLesson(tinyLesson(state, true)).issues.map((issue) => issue.code)).toEqual(["unknown_part"])
    }
  })
})

const entry = (provider: ModelEntry["provider"], extra: Partial<ModelEntry> = {}): ModelEntry => ({
  id: `${provider}-test`,
  label: provider,
  provider,
  model: `${provider}-model`,
  context_window: 100_000,
  max_tokens: 4096,
  cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75, cache_write_1h: 6 },
  ...extra,
})

const usage = (fields: Partial<Usage>): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  ...fields,
})

describe("job cost", () => {
  it("prices 1-hour cache writes at cache_write_1h and the rest at cache_write", () => {
    const anthropic = entry("anthropic")
    const reported = usage({
      input: 1000,
      output: 100,
      cacheRead: 10_000,
      cacheWrite: 3000,
      cacheWrite1h: 2000,
    })
    expect(costOf(anthropic, reported, true)).toBeCloseTo(
      (1000 * 3 + 100 * 15 + 10_000 * 0.3 + 1000 * 3.75 + 2000 * 6) / 1e6,
      12,
    )
    // No split reported: a run that asked for 1-hour writes pays them all at the 1-hour price.
    const unsplit = usage({ cacheWrite: 1000 })
    expect(costOf(anthropic, unsplit, true)).toBeCloseTo((1000 * 6) / 1e6, 12)
    expect(costOf(anthropic, unsplit, false)).toBeCloseTo((1000 * 3.75) / 1e6, 12)
    // Without a 1-hour price, cache_write is used.
    const { cache_write_1h: _, ...cost } = anthropic.cost
    expect(costOf({ ...anthropic, cost }, unsplit, true)).toBeCloseTo((1000 * 3.75) / 1e6, 12)
  })

  it("marks only the conversation tail for 5 minutes", () => {
    const long = { type: "ephemeral", ttl: "1h" }
    const payload = {
      system: [{ type: "text", text: "s", cache_control: long }],
      tools: [{ name: "t", cache_control: long }],
      messages: [{ role: "user", content: [{ type: "text", text: "u", cache_control: long }] }],
    }
    expect(shortTail(payload)).toEqual({
      ...payload,
      messages: [
        { role: "user", content: [{ type: "text", text: "u", cache_control: { type: "ephemeral" } }] },
      ],
    })
  })
})

describe("provider errors", () => {
  it("say what happened in plain words and keep the provider's short message", () => {
    const refused = providerError(
      '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      "byok",
    )
    expect(refused).toContain("refused your API key")
    expect(refused).toContain("401: invalid x-api-key")
    expect(providerError('429: {"error":{"message":"Rate limit reached"}}', "byok")).toContain(
      "rate limiting",
    )
    expect(providerError("529 overloaded", "platform")).toContain("had an error (529)")
  })

  it("never show text that is not a provider's HTTP error", () => {
    expect(providerError("D1_ERROR: no such table: generation_job", "platform")).toBe(
      "the model request failed. Try again later.",
    )
    expect(providerError("TypeError: fetch failed", "byok")).toBe(
      "the model request failed. Try again later.",
    )
  })
})

// The request body pi would send, through the stream of a model built from config.
const firstBody = async (model: ModelEntry, cacheRetention: "long" | "short") => {
  const bodies: Array<unknown> = []
  const fetch: typeof globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      bodies.push(JSON.parse(await request.text()))
      return fakeProvider({ script: () => ({ type: "text", text: "ok" }) })(input, init)
    },
    { preconnect: () => undefined },
  )
  const { model: piModel, stream } = piModelOf(model)
  const events = await stream(
    piModel,
    normalizeContext({ systemPrompt: "system", messages: [{ role: "user", content: "hi", timestamp: 0 }] }),
    { apiKey: "sk-test", cacheRetention, sessionId: "learn-lesson-writer", fetch },
  )
  await events.result()
  return bodies[0]
}

describe("OpenAI-compatible cache settings", () => {
  it("send DeepSeek neither prompt_cache_key nor a retention", async () => {
    for (const retention of ["long", "short"] as const) {
      const body = await firstBody(entry("deepseek"), retention)
      expect(body).not.toHaveProperty("prompt_cache_key")
      expect(body).not.toHaveProperty("prompt_cache_retention")
    }
  })

  it("send OpenAI the shared prompt_cache_key, never the 24h retention", async () => {
    const body = await firstBody(entry("openai"), "long")
    expect(body).toHaveProperty("prompt_cache_key", "learn-lesson-writer")
    expect(body).not.toHaveProperty("prompt_cache_retention")
  })
})
