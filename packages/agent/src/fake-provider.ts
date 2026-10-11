// A scripted model for dev and tests: a `fetch` that answers pi-ai's Anthropic Messages and OpenAI
// Chat Completions requests with Server-Sent Events, as the real APIs do, without the network.
// GENERATION_MODELS may list provider `fake` only when APP_ENV is dev or test (GenerationSettings).
//
// The default script writes a tiny lesson about the user's topic the way a model should:
// search_concepts → validate_lesson (a draft with an issue) → validate_lesson (fixed) → save_draft.

export interface FakeState {
  // The user's topic and the language asked for, read back from the user message.
  readonly topic: string
  readonly lang: "en" | "th"
  // The text of every tool result so far, oldest first.
  readonly toolResults: ReadonlyArray<string>
}

export type FakeAction =
  | { readonly type: "tool"; readonly name: string; readonly input: Readonly<Record<string, unknown>> }
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "error"; readonly status: number; readonly message: string }

export interface FakeRequest {
  readonly url: string
  readonly headers: Headers
  // The parsed JSON body.
  readonly body: unknown
}

export interface FakeOptions {
  readonly script?: (state: FakeState) => FakeAction
  // Every request, as sent (tests compare prompt prefixes and keys).
  readonly onRequest?: (request: FakeRequest) => void
}

export const fakeProvider = (options: FakeOptions = {}): typeof fetch => {
  const script = options.script ?? lessonScript
  let calls = 0
  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const text = await request.text()
    const body: unknown = text === "" ? null : JSON.parse(text)
    options.onRequest?.({ url: request.url, headers: request.headers, body })
    calls += 1
    const openai = new URL(request.url).pathname.endsWith("/chat/completions")
    const state = stateOf(body, openai)
    const action = script(state)
    if (action.type === "error") {
      return Response.json(
        openai
          ? { error: { message: action.message, type: "invalid_request_error" } }
          : { type: "error", error: { type: "authentication_error", message: action.message } },
        { status: action.status },
      )
    }
    const usage = fakeUsage(state.toolResults.length, ttlsOf(body))
    const events = openai ? openaiEvents(action, calls, usage) : anthropicEvents(action, calls, usage)
    return new Response(events, { headers: { "content-type": "text/event-stream" } })
  }
  return Object.assign(handler, { preconnect: () => undefined })
}

// ── The default script

export const lessonScript = (state: FakeState): FakeAction => {
  const step = state.toolResults.length
  if (step === 0) return { type: "tool", name: "search_concepts", input: { q: firstWords(state.topic) } }
  if (step === 1) return { type: "tool", name: "validate_lesson", input: { spec: tinyLesson(state, true) } }
  if (step === 2) return { type: "tool", name: "validate_lesson", input: { spec: tinyLesson(state, false) } }
  if (step === 3) return { type: "tool", name: "save_draft", input: {} }
  return { type: "text", text: "Saved." }
}

// A small valid lesson about the topic. `broken` links a part that does not exist, which
// validate_lesson reports as unknown_part.
export const tinyLesson = (state: Pick<FakeState, "topic" | "lang">, broken = false) => {
  const topic = plain(state.topic)
  const th = state.lang === "th"
  return {
    schema: 1,
    kind: "learn",
    lang: state.lang,
    title: `${th ? "บทเรียน" : "Lesson"}: ${topic.slice(0, 80)}`,
    summary: th ? `ร่างบทเรียนสั้น ๆ เรื่อง ${topic.slice(0, 120)}` : `A short draft about ${topic.slice(0, 120)}`,
    parts: {
      idea: { label: th ? "แนวคิด" : "the idea", role: "concept", color: "blue", meaning: "the main idea" },
    },
    cards: {},
    sections: [
      {
        id: "intro",
        type: "text",
        body: th
          ? `บทนี้พูดถึง [idea:แนวคิดหลัก]: ${topic}`
          : `This lesson is about [idea:the main idea]: ${topic}`,
      },
      {
        id: "check",
        type: "check",
        items: [
          broken
            ? th
              ? "อธิบาย [speed:ความเร็ว] ได้ไหม"
              : "Can you explain [speed:the speed]?"
            : th
              ? "อธิบาย [idea:แนวคิดนี้] ได้ไหม"
              : "Can you explain [idea:the idea] in your own words?",
        ],
      },
    ],
  }
}

const firstWords = (text: string) => plain(text).split(/\s+/u).slice(0, 4).join(" ") || "lesson"

// The topic as plain Rich text: markup characters dropped, so it cannot add links.
const plain = (text: string) =>
  text
    .replace(/[[\]{}$*`|_\\]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()

// ── Reading the request

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((block) => (isRecord(block) && typeof block.text === "string" ? block.text : ""))
    .join("")
}

const stateOf = (body: unknown, openai: boolean): FakeState => {
  const messages = isRecord(body) && Array.isArray(body.messages) ? body.messages.filter(isRecord) : []
  const toolResults: Array<string> = []
  let userText = ""
  for (const message of messages) {
    if (openai && message.role === "tool") toolResults.push(textOf(message.content))
    if (message.role !== "user") continue
    if (userText === "") userText = textOf(message.content)
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (isRecord(block) && block.type === "tool_result") toolResults.push(textOf(block.content))
      }
    }
  }
  const topic = /---\n([\s\S]*)\n---/u.exec(userText)?.[1] ?? userText
  const lang = /"lang": "th"/u.test(userText) ? "th" : "en"
  return { topic, lang, toolResults }
}

// ── Writing the response

export interface FakeUsage {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  // Anthropic only: the prefix and the tail written to the cache, by retention.
  readonly cacheWrite5m: number
  readonly cacheWrite1h: number
}

// The cache marks of an Anthropic request: the retention of the prefix (system) and of the tail
// (the last message), "1h" or "5m"; undefined where there is none.
export interface FakeTtls {
  readonly prefix: "1h" | "5m" | undefined
  readonly tail: "1h" | "5m" | undefined
}

// What the fake model reports for the request of a job's `step` (0 = its first request). The
// first request writes the prefix to the cache; later ones read it. Every request writes its new
// tail where it is marked.
export const fakeUsage = (step: number, ttls: FakeTtls): FakeUsage => {
  const prefixWrite = step === 0 ? 9000 : 0
  const tailWrite = ttls.tail === undefined ? 0 : 150
  const write = (ttl: "1h" | "5m" | undefined, tokens: number) => ({
    short: ttl === "1h" ? 0 : tokens,
    long: ttl === "1h" ? tokens : 0,
  })
  const prefix = write(ttls.prefix, ttls.prefix === undefined ? 0 : prefixWrite)
  const tail = write(ttls.tail, tailWrite)
  return {
    input: 120 + step * 40,
    output: 60 + step * 10,
    cacheRead: step === 0 ? 0 : 9000,
    cacheWrite5m: prefix.short + tail.short,
    cacheWrite1h: prefix.long + tail.long,
  }
}

const ttlOf = (block: unknown): "1h" | "5m" | undefined => {
  if (!isRecord(block) || !isRecord(block.cache_control)) return undefined
  return block.cache_control.ttl === "1h" ? "1h" : "5m"
}

export const ttlsOf = (body: unknown): FakeTtls => {
  const system = isRecord(body) && Array.isArray(body.system) ? body.system : []
  const messages = isRecord(body) && Array.isArray(body.messages) ? body.messages : []
  const last = messages.at(-1)
  const lastBlocks = isRecord(last) && Array.isArray(last.content) ? last.content : []
  return {
    prefix: system.map(ttlOf).find((ttl) => ttl !== undefined),
    tail: lastBlocks.map(ttlOf).find((ttl) => ttl !== undefined),
  }
}

const sse = (events: ReadonlyArray<readonly [string | undefined, unknown]>) =>
  events
    .map(([event, data]) =>
      event === undefined
        ? `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`
        : `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    )
    .join("")

const anthropicEvents = (action: Exclude<FakeAction, { type: "error" }>, call: number, usage: FakeUsage) => {
  const start: readonly [string, unknown] = [
    "message_start",
    {
      type: "message_start",
      message: {
        id: `msg_fake_${call}`,
        type: "message",
        role: "assistant",
        model: "fake",
        content: [],
        stop_reason: null,
        usage: {
          input_tokens: usage.input,
          output_tokens: 1,
          cache_read_input_tokens: usage.cacheRead,
          cache_creation_input_tokens: usage.cacheWrite5m + usage.cacheWrite1h,
          cache_creation: {
            ephemeral_5m_input_tokens: usage.cacheWrite5m,
            ephemeral_1h_input_tokens: usage.cacheWrite1h,
          },
        },
      },
    },
  ]
  const block: ReadonlyArray<readonly [string, unknown]> =
    action.type === "tool"
      ? [
          [
            "content_block_start",
            {
              type: "content_block_start",
              index: 0,
              content_block: { type: "tool_use", id: `toolu_fake_${call}`, name: action.name, input: {} },
            },
          ],
          [
            "content_block_delta",
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "input_json_delta", partial_json: JSON.stringify(action.input) },
            },
          ],
        ]
      : [
          [
            "content_block_start",
            { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          ],
          [
            "content_block_delta",
            { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: action.text } },
          ],
        ]
  return sse([
    start,
    ...block,
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    [
      "message_delta",
      {
        type: "message_delta",
        delta: { stop_reason: action.type === "tool" ? "tool_use" : "end_turn" },
        usage: { output_tokens: usage.output },
      },
    ],
    ["message_stop", { type: "message_stop" }],
  ])
}

const openaiEvents = (action: Exclude<FakeAction, { type: "error" }>, call: number, usage: FakeUsage) => {
  const chunk = (choice: unknown) => ({
    id: `chatcmpl-fake-${call}`,
    object: "chat.completion.chunk",
    created: 0,
    model: "fake",
    choices: [choice],
  })
  const delta =
    action.type === "tool"
      ? {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              index: 0,
              id: `call_fake_${call}`,
              type: "function",
              function: { name: action.name, arguments: JSON.stringify(action.input) },
            },
          ],
        }
      : { role: "assistant", content: action.text }
  return sse([
    [undefined, chunk({ index: 0, delta, finish_reason: null })],
    [
      undefined,
      chunk({ index: 0, delta: {}, finish_reason: action.type === "tool" ? "tool_calls" : "stop" }),
    ],
    [
      undefined,
      {
        id: `chatcmpl-fake-${call}`,
        object: "chat.completion.chunk",
        created: 0,
        model: "fake",
        choices: [],
        usage: {
          prompt_tokens: usage.input + usage.cacheRead,
          completion_tokens: usage.output,
          total_tokens: usage.input + usage.cacheRead + usage.output,
          prompt_tokens_details: { cached_tokens: usage.cacheRead },
        },
      },
    ],
    [undefined, "[DONE]"],
  ])
}
