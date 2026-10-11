import {
  type FakeAction,
  type FakeState,
  tinyLesson as fakeLesson,
  fakeUsage,
  lessonScript,
  systemPrompt,
} from "@app/agent"
import { type Generation, GenerationEvent, type GenerationId } from "@app/api"
import { openByokKey } from "@app/services"
import { assert, layer } from "@effect/vitest"
import { Effect, Schema } from "effect"
import {
  anonymous,
  clientWith,
  jsonBytes,
  rawFetch,
  signIn,
  TestEnv,
  TestLayer,
  testDailyJobs,
  testKek,
  testMaxTurns,
  testPlatformKey,
  tinyLesson,
} from "./support.ts"

// AI lesson generation (ADR 0009): a whole job against the fake provider (no network), the quota,
// BYOK keys, owner-only access, and the shared prompt prefix that keeps the cache warm.

const prompt = "Average speed of a trip that has a 30 minute stop"

type Client = Effect.Success<ReturnType<typeof signIn>>["client"]

// Starts a job and waits for its in-process run to end.
const generate = (
  client: Client,
  options: {
    readonly model?: string
    readonly billing?: "platform" | "byok"
    readonly lang?: "en" | "th"
  } = {},
) =>
  Effect.gen(function* () {
    const env = yield* TestEnv
    const started = yield* client.generations.create({
      payload: {
        prompt,
        lang: options.lang ?? "en",
        model: options.model ?? "claude-test",
        billing: options.billing ?? "platform",
      },
    })
    yield* Effect.promise(() => env.settle(started.id))
    return yield* client.generations.get({ params: { id: started.id } })
  })

const useScript = (script: (state: FakeState) => FakeAction) =>
  Effect.gen(function* () {
    const env = yield* TestEnv
    env.model.script = script
    env.model.requests.length = 0
  })

const eventsOf = (cookie: string, id: GenerationId) =>
  Effect.gen(function* () {
    const response = yield* rawFetch(`/api/generations/${id}/events`, { headers: { cookie } })
    const text = yield* Effect.promise(() => response.text())
    const events = text
      .split("\n\n")
      .filter((frame) => frame.startsWith("id: "))
      .map((frame) =>
        Schema.decodeUnknownSync(Schema.fromJsonString(GenerationEvent))(frame.split("data: ")[1]),
      )
    return { response, events }
  })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// The cached prefix of an Anthropic request: tools and system, as sent.
const prefixOf = (body: unknown) => {
  assert.isTrue(isRecord(body))
  if (!isRecord(body)) return { tools: "", system: "" }
  return { tools: JSON.stringify(body.tools), system: JSON.stringify(body.system) }
}

// Waits until the job's run has marked it running.
const untilRunning = (client: Client, id: GenerationId) =>
  Effect.gen(function* () {
    for (let tries = 0; tries < 200; tries++) {
      if ((yield* client.generations.get({ params: { id } })).status === "running") return
      yield* Effect.sleep("5 millis")
    }
    assert.fail("the job never started running")
  })

const usedToday = (client: Client) =>
  client.generations.options().pipe(Effect.map((options) => options.used_today))

layer(TestLayer, { excludeTestServices: true })("generations", (it) => {
  it.effect("runs a job: search, validate with issues, save a private draft", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      yield* useScript(lessonScript)
      const author = yield* signIn("Gen Author")
      const other = yield* signIn("Gen Other")

      const options = yield* author.client.generations.options()
      assert.deepStrictEqual(
        options.models.map((model) => [model.id, model.platform]),
        [
          ["claude-test", true],
          ["deepseek-test", false],
          ["fake", true],
        ],
      )
      assert.strictEqual(options.daily_limit, testDailyJobs)
      assert.strictEqual(options.used_today, 0)
      assert.isTrue(options.byok_enabled)

      const job = yield* generate(author.client)
      assert.strictEqual(job.status, "succeeded", job.error ?? "")
      assert.isNull(job.error)
      assert.strictEqual(job.turns, 4)
      assert.isNotNull(job.draft)
      assert.isAbove(job.usage.input, 0)
      assert.isAbove(job.usage.cache_read, 0)
      assert.isAbove(job.usage.cache_write, 0)
      assert.isAbove(job.usage.cost_usd, 0)
      assert.strictEqual(yield* usedToday(author.client), 1)

      // The model saw the issue of its first draft, and saved the fixed one.
      const requests = env.model.requests
      assert.strictEqual(requests.length, 4)
      const toolResults = JSON.stringify(requests[3]?.body)
      assert.include(toolResults, "unknown_part")
      for (const request of requests) {
        assert.strictEqual(request.headers.get("x-api-key"), testPlatformKey)
        assert.strictEqual(new URL(request.url).pathname, "/v1/messages")
      }
      // Platform runs ask for the 1-hour cache on the prefix: the system block and the last tool.
      const first = requests[0]?.body
      assert.isTrue(isRecord(first))
      if (isRecord(first) && Array.isArray(first.system) && Array.isArray(first.tools)) {
        assert.deepInclude(first.system[0], { cache_control: { type: "ephemeral", ttl: "1h" } })
        assert.deepInclude(first.tools.at(-1), { cache_control: { type: "ephemeral", ttl: "1h" } })
        assert.deepStrictEqual(
          first.tools.map((tool: unknown) => (isRecord(tool) ? tool.name : undefined)),
          ["search_concepts", "get_concept", "validate_lesson", "save_draft"],
        )
        assert.strictEqual(JSON.stringify(first.system[0]).includes("LessonSpec"), true)
      }

      // The draft is a private lesson of the author.
      const draft = job.draft
      if (draft === null) return
      const lesson = yield* author.client.lessons.get({ params: { id: draft.lesson_id } })
      assert.strictEqual(lesson.visibility, "private")
      assert.isTrue(lesson.is_owner)
      assert.include(lesson.title, "Average speed")
      assert.match(draft.slug, /^lesson-average-speed-of-a-trip-that-has-a-30-minute-stop-[0-9a-f]{6}$/)
      assert.strictEqual(
        (yield* other.client.lessons.get({ params: { id: draft.lesson_id } }).pipe(Effect.flip))._tag,
        "LessonNotFound",
      )
      assert.strictEqual(
        (yield* (yield* anonymous()).lessons.get({ params: { id: draft.lesson_id } }).pipe(Effect.flip))._tag,
        "LessonNotFound",
      )

      // The progress stream: the steps, the fix, the result.
      const { response, events } = yield* eventsOf(author.cookie, job.id)
      assert.strictEqual(response.status, 200)
      assert.include(response.headers.get("content-type") ?? "", "text/event-stream")
      const steps = events.flatMap((event) =>
        event.type === "tool" && event.phase === "end"
          ? [`${event.tool}:${event.ok}:${event.issue_count}`]
          : [],
      )
      assert.deepStrictEqual(steps, [
        "search_concepts:true:0",
        "validate_lesson:false:1",
        "validate_lesson:true:0",
        "save_draft:true:0",
      ])
      const fixing = events.find((event) => event.type === "tool" && event.ok === false)
      assert.strictEqual(fixing?.type === "tool" ? fixing.issues[0]?.code : undefined, "unknown_part")
      const done = events.at(-1)
      assert.strictEqual(done?.type, "done")
      if (done?.type === "done") {
        assert.strictEqual(done.status, "succeeded")
        assert.strictEqual(done.draft?.lesson_id, draft.lesson_id)
      }
      // Resuming after an event id replays only what came after it.
      const resumed = yield* rawFetch(`/api/generations/${job.id}/events`, {
        headers: { cookie: author.cookie, "last-event-id": String(events.length - 1) },
      })
      const tail = (yield* Effect.promise(() => resumed.text())).split("\n\n").filter((frame) => frame !== "")
      assert.strictEqual(tail.length, 1)
      assert.include(tail[0] ?? "", '"type":"done"')

      // Listed for the author only.
      const mine = yield* author.client.generations.list({ query: {} })
      assert.deepStrictEqual(
        mine.items.map((item) => item.id),
        [job.id],
      )
      assert.strictEqual((yield* other.client.generations.list({ query: {} })).items.length, 0)
    }),
  )

  it.effect("keeps the prompt prefix byte-identical across users and billing", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      yield* useScript(lessonScript)
      const first = yield* signIn("Prefix One")
      const second = yield* signIn("Prefix Two")
      yield* generate(first.client)
      const one = env.model.requests[0]?.body
      env.model.requests.length = 0
      yield* generate(second.client, { lang: "th" })
      const two = env.model.requests[0]?.body

      assert.strictEqual(prefixOf(one).tools, prefixOf(two).tools)
      assert.strictEqual(prefixOf(one).system, prefixOf(two).system)
      // Nothing about the user or the job is in the prefix.
      for (const value of [
        first.user.id,
        first.user.email,
        first.user.name,
        second.user.id,
        second.user.email,
      ]) {
        assert.notInclude(prefixOf(one).system + prefixOf(one).tools, value)
      }
      assert.isTrue(isRecord(one) && !("metadata" in one))
      // The system block is exactly the static prompt.
      assert.include(prefixOf(one).system, JSON.stringify(systemPrompt).slice(1, 200))
    }),
  )

  it.effect("refuses a platform job past the daily quota, and gives back a failed one", () =>
    Effect.gen(function* () {
      yield* useScript(lessonScript)
      const user = yield* signIn("Quota User")
      for (let index = 0; index < testDailyJobs - 1; index++) {
        assert.strictEqual((yield* generate(user.client)).status, "succeeded")
      }
      // A job the provider refuses before charging anything does not count.
      yield* useScript(() => ({ type: "error", status: 401, message: "invalid x-api-key" }))
      const refused = yield* generate(user.client)
      assert.strictEqual(refused.status, "failed")
      assert.include(refused.error ?? "", "invalid x-api-key")
      assert.strictEqual(yield* usedToday(user.client), testDailyJobs - 1)

      yield* useScript(lessonScript)
      assert.strictEqual((yield* generate(user.client)).status, "succeeded")
      assert.strictEqual(yield* usedToday(user.client), testDailyJobs)
      const over = yield* user.client.generations
        .create({ payload: { prompt, lang: "en", model: "claude-test", billing: "platform" } })
        .pipe(Effect.flip)
      assert.strictEqual(over._tag, "GenerationQuotaExceeded")
      if (over._tag === "GenerationQuotaExceeded") assert.strictEqual(over.limit, testDailyJobs)
      const raw = yield* rawFetch("/api/generations", {
        method: "POST",
        headers: { cookie: user.cookie, "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ prompt, lang: "en", model: "claude-test", billing: "platform" }),
      })
      assert.strictEqual(raw.status, 429)
      assert.strictEqual((yield* user.client.generations.list({ query: {} })).items.length, testDailyJobs + 1)
    }),
  )

  it.effect("runs one job at a time per user, and cancels a running job", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      yield* useScript(lessonScript)
      const user = yield* signIn("Busy Generator")
      let release = () => {}
      env.model.hold = new Promise<void>((resolve) => {
        release = resolve
      })
      const running = yield* user.client.generations.create({
        payload: { prompt, lang: "en", model: "claude-test", billing: "platform" },
      })
      const busy = yield* user.client.generations
        .create({ payload: { prompt, lang: "en", model: "claude-test", billing: "platform" } })
        .pipe(Effect.flip)
      assert.strictEqual(busy._tag, "GenerationBusy")
      assert.strictEqual(yield* usedToday(user.client), 1)

      const canceled = yield* user.client.generations.cancel({ params: { id: running.id } })
      assert.strictEqual(canceled.status, "canceled")
      // The job's runner was told to stop now, not at the end of its model request.
      assert.include(env.model.cancels, running.id)
      release()
      env.model.hold = undefined
      yield* Effect.promise(() => env.settle(running.id))
      const after = yield* user.client.generations.get({ params: { id: running.id } })
      assert.strictEqual(after.status, "canceled")
      assert.isNotNull(after.finished_at)
      assert.isNull(after.draft)
      // Nothing was charged, so the quota came back.
      assert.strictEqual(yield* usedToday(user.client), 0)
      // A finished job cancels to itself.
      assert.strictEqual(
        (yield* user.client.generations.cancel({ params: { id: running.id } })).status,
        "canceled",
      )
    }),
  )

  it.effect("stops a job after the turn limit", () =>
    Effect.gen(function* () {
      yield* useScript(() => ({ type: "tool", name: "search_concepts", input: { q: "speed" } }))
      const user = yield* signIn("Looping User")
      const job = yield* generate(user.client)
      assert.strictEqual(job.status, "failed")
      assert.strictEqual(job.turns, testMaxTurns)
      assert.include(job.error ?? "", `${testMaxTurns} model requests`)
      // It ran and was charged: it counts.
      assert.strictEqual(yield* usedToday(user.client), 1)
    }),
  )

  it.effect("tools act for the job's user only", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const victim = yield* signIn("Tool Victim")
      const attacker = yield* signIn("Tool Attacker")
      const target = yield* victim.client.lessons.publish({
        params: { slug: "victim" },
        payload: jsonBytes(tinyLesson("en", "victim")),
      })
      const lesson = fakeLesson({ topic: "hijack", lang: "en" })
      // The model tries to name another owner and lesson; the tool schema refuses unknown
      // arguments, and a saved draft always belongs to the job's user.
      yield* useScript((state) => {
        const step = state.toolResults.length
        if (step === 0) {
          return {
            type: "tool",
            name: "save_draft",
            input: { spec: lesson, owner_id: victim.user.id, lesson_id: target.lesson.id, slug: "victim" },
          }
        }
        if (step === 1)
          return { type: "tool", name: "save_draft", input: { spec: { ...lesson, title: "victim" } } }
        return { type: "text", text: "done" }
      })
      const job = yield* generate(attacker.client)
      assert.strictEqual(job.status, "succeeded", job.error ?? "")
      const refusedArguments = JSON.stringify(env.model.requests[1]?.body)
      assert.include(refusedArguments, "owner_id")

      const draft = job.draft
      assert.isNotNull(draft)
      if (draft === null) return
      assert.notStrictEqual(draft.lesson_id, target.lesson.id)
      assert.notStrictEqual(draft.owner_handle, target.lesson.owner_handle)
      const saved = yield* attacker.client.lessons.get({ params: { id: draft.lesson_id } })
      assert.isTrue(saved.is_owner)
      // The victim's lesson is untouched and the attacker's draft is invisible to the victim.
      const versions = yield* victim.client.lessons.versions({ params: { id: target.lesson.id }, query: {} })
      assert.strictEqual(versions.length, 1)
      assert.strictEqual(
        (yield* victim.client.lessons.get({ params: { id: draft.lesson_id } }).pipe(Effect.flip))._tag,
        "LessonNotFound",
      )
    }),
  )

  it.effect("stores a BYOK key encrypted, never returns it, and bills a job to it", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      yield* useScript(lessonScript)
      const user = yield* signIn("Key Owner")
      const other = yield* signIn("Key Other")
      const key = `sk-${"a1B2c3D4".repeat(5)}wxyz`

      assert.deepStrictEqual(yield* user.client.keys.list(), [])
      const invalid = yield* user.client.keys
        .set({ params: { provider: "anthropic" }, payload: { key: "sk-ant-oat01-not-an-api-key-1234" } })
        .pipe(Effect.flip)
      assert.strictEqual(invalid._tag, "InvalidByokKey")
      const stored = yield* user.client.keys.set({ params: { provider: "deepseek" }, payload: { key } })
      assert.deepStrictEqual([stored.provider, stored.last4], ["deepseek", "wxyz"])

      // Nowhere in the API, nor in plain text in D1.
      const listed = yield* rawFetch("/api/me/keys", { headers: { cookie: user.cookie } })
      const listedText = yield* Effect.promise(() => listed.text())
      assert.notInclude(listedText, key.slice(0, 20))
      assert.include(listedText, "wxyz")
      const optionsResponse = yield* rawFetch("/api/generations/options", {
        headers: { cookie: user.cookie },
      })
      const optionsText = yield* Effect.promise(() => optionsResponse.text())
      assert.notInclude(optionsText, key.slice(0, 20))
      const row = yield* Effect.promise(() =>
        env.db
          .prepare("select * from byok_key where user_id = ?")
          .bind(user.user.id)
          .first<{ ciphertext: string; iv: string }>(),
      )
      assert.isNotNull(row)
      if (row === null) return
      assert.notInclude(JSON.stringify(row), key.slice(3, 20))
      // AES-GCM round trip, bound to the user and provider.
      const kek = yield* Effect.promise(() =>
        crypto.subtle.importKey(
          "raw",
          Uint8Array.from(atob(testKek), (char) => char.charCodeAt(0)),
          { name: "AES-GCM" },
          false,
          ["decrypt"],
        ),
      )
      assert.strictEqual(yield* Effect.promise(() => openByokKey(kek, user.user.id, "deepseek", row)), key)
      const swapped = yield* Effect.promise(() =>
        openByokKey(kek, other.user.id, "deepseek", row).then(
          () => "decrypted",
          () => "refused",
        ),
      )
      assert.strictEqual(swapped, "refused")

      // A BYOK job uses the user's key, through the OpenAI-compatible API, and no platform quota.
      const job = yield* generate(user.client, { model: "deepseek-test", billing: "byok" })
      assert.strictEqual(job.status, "succeeded", job.error ?? "")
      assert.strictEqual(yield* usedToday(user.client), 0)
      const requests = env.model.requests
      assert.isTrue(requests.length > 0)
      for (const request of requests) {
        assert.strictEqual(request.headers.get("authorization"), `Bearer ${key}`)
        assert.strictEqual(new URL(request.url).pathname, "/chat/completions")
      }
      // Same static system prompt as the Anthropic runs.
      const first = requests[0]?.body
      const system =
        isRecord(first) && Array.isArray(first.messages) && isRecord(first.messages[0])
          ? first.messages[0].content
          : ""
      assert.strictEqual(system, systemPrompt)

      // Refusals: no key for that provider, a BYOK-only model on platform billing, a token.
      const missing = yield* user.client.generations
        .create({ payload: { prompt, lang: "en", model: "claude-test", billing: "byok" } })
        .pipe(Effect.flip)
      assert.strictEqual(missing._tag, "ByokKeyMissing")
      const platformOnly = yield* user.client.generations
        .create({ payload: { prompt, lang: "en", model: "deepseek-test", billing: "platform" } })
        .pipe(Effect.flip)
      assert.strictEqual(platformOnly._tag, "PlatformBillingUnavailable")
      const token = yield* user.client.tokens.create({ payload: { name: "pi" } })
      const viaToken = yield* clientWith({ authorization: `Bearer ${token.secret}` })
      assert.strictEqual((yield* viaToken.keys.list().pipe(Effect.flip))._tag, "Unauthenticated")

      // Another user sees none of it; removing twice is a 404.
      assert.deepStrictEqual(yield* other.client.keys.list(), [])
      yield* user.client.keys.remove({ params: { provider: "deepseek" } })
      assert.strictEqual(
        (yield* user.client.keys.remove({ params: { provider: "deepseek" } }).pipe(Effect.flip))._tag,
        "ByokKeyNotFound",
      )
    }),
  )

  it.effect("validates the request", () =>
    Effect.gen(function* () {
      const user = yield* signIn("Picky User")
      const unknown = yield* user.client.generations
        .create({ payload: { prompt, lang: "en", model: "gpt-nope", billing: "platform" } })
        .pipe(Effect.flip)
      assert.strictEqual(unknown._tag, "InvalidGeneration")
      const short = yield* rawFetch("/api/generations", {
        method: "POST",
        headers: { cookie: user.cookie, "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ prompt: "hi", lang: "en", model: "claude-test", billing: "platform" }),
      })
      assert.strictEqual(short.status, 400)
      const jobs: ReadonlyArray<Generation> = (yield* user.client.generations.list({ query: {} })).items
      assert.strictEqual(jobs.length, 0)
    }),
  )

  it.effect("bills 1-hour writes on the prefix only, at the 1-hour price", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      yield* useScript(lessonScript)
      const user = yield* signIn("Cache Payer")
      const job = yield* generate(user.client)
      assert.strictEqual(job.status, "succeeded", job.error ?? "")
      const requests = env.model.requests
      assert.strictEqual(requests.length, 4)
      // The prefix (system, last tool) keeps the 1-hour mark; the conversation tail gets 5 minutes.
      for (const request of requests) {
        const body = request.body
        assert.isTrue(isRecord(body))
        if (!isRecord(body) || !Array.isArray(body.messages) || !Array.isArray(body.system)) continue
        assert.deepInclude(body.system[0], { cache_control: { type: "ephemeral", ttl: "1h" } })
        const marks = JSON.stringify(body.messages).match(/"cache_control":\{[^}]*\}/g) ?? []
        assert.isAbove(marks.length, 0)
        for (const mark of marks) assert.strictEqual(mark, '"cache_control":{"type":"ephemeral"}')
      }
      // claude-test: input 3, output 15, read 0.3, 5-minute write 3.75, 1-hour write 6 ($/M).
      const expected = [0, 1, 2, 3]
        .map((step) => fakeUsage(step, { prefix: "1h", tail: "5m" }))
        .reduce(
          (sum, usage) =>
            sum +
            (usage.input * 3 +
              usage.output * 15 +
              usage.cacheRead * 0.3 +
              usage.cacheWrite5m * 3.75 +
              usage.cacheWrite1h * 6) /
              1e6,
          0,
        )
      assert.strictEqual(job.usage.cost_usd, Math.round(expected * 1e6) / 1e6)
    }),
  )

  it.effect("keeps the usage and the quota spent when our side fails mid-run", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      yield* useScript(lessonScript)
      const user = yield* signIn("Broken Storage")
      // The progress sink fails as the second model request starts: the first was paid for.
      env.model.failEmit = (event) => event.type === "turn" && event.n === 2
      const job = yield* generate(user.client).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            env.model.failEmit = undefined
          }),
        ),
      )
      assert.strictEqual(job.status, "failed")
      assert.strictEqual(job.error, "something went wrong on our side; try again")
      assert.isAbove(job.usage.input, 0)
      assert.isAbove(job.usage.output, 0)
      assert.isAbove(job.usage.cost_usd, 0)
      // Charged, so not given back.
      assert.strictEqual(yield* usedToday(user.client), 1)
      const { events } = yield* eventsOf(user.cookie, job.id)
      assert.notInclude(JSON.stringify(events), "D1_ERROR")
    }),
  )

  it.effect("fails a run past the wall-clock limit as timed out, not canceled", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      yield* useScript(lessonScript)
      const user = yield* signIn("Slow Model")
      let release = () => {}
      env.model.hold = new Promise<void>((resolve) => {
        release = resolve
      })
      env.model.timeoutMs = 150
      const job = yield* generate(user.client).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            release()
            env.model.hold = undefined
            env.model.timeoutMs = undefined
          }),
        ),
      )
      assert.strictEqual(job.status, "failed")
      assert.include(job.error ?? "", "timed out")
      // Nothing was charged: the quota comes back.
      assert.strictEqual(yield* usedToday(user.client), 0)
    }),
  )

  it.effect("a draft saved while a cancel lands makes the job done, not canceled", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const user = yield* signIn("Late Canceler")
      yield* useScript((state) =>
        state.toolResults.length === 0
          ? {
              type: "tool",
              name: "save_draft",
              input: { spec: fakeLesson({ topic: state.topic, lang: "en" }) },
            }
          : { type: "text", text: "done" },
      )
      let release = () => {}
      env.model.hold = new Promise<void>((resolve) => {
        release = resolve
      })
      const job = yield* user.client.generations.create({
        payload: { prompt, lang: "en", model: "claude-test", billing: "platform" },
      })
      yield* untilRunning(user.client, job.id)
      // The cancel's row update lands, but its signal to the runner does not arrive in time: the
      // model's answer (save_draft) is already on its way.
      yield* Effect.promise(() =>
        env.db.prepare("update generation_job set status = 'canceled' where id = ?").bind(job.id).run(),
      )
      release()
      env.model.hold = undefined
      yield* Effect.promise(() => env.settle(job.id))
      const after = yield* user.client.generations.get({ params: { id: job.id } })
      assert.strictEqual(after.status, "succeeded")
      assert.isNotNull(after.draft)
      assert.isNull(after.error)
      const { events } = yield* eventsOf(user.cookie, job.id)
      const done = events.at(-1)
      assert.strictEqual(done?.type === "done" ? done.status : undefined, "succeeded")
    }),
  )

  it.effect("cancels a queued job at once: it never runs, and its quota comes back", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      yield* useScript(lessonScript)
      const user = yield* signIn("Quick Canceler")
      let start = () => {}
      env.model.deferStart = new Promise<void>((resolve) => {
        start = resolve
      })
      env.model.requests.length = 0
      const job = yield* user.client.generations.create({
        payload: { prompt, lang: "en", model: "claude-test", billing: "platform" },
      })
      env.model.deferStart = undefined
      assert.strictEqual(job.status, "queued")
      assert.strictEqual(yield* usedToday(user.client), 1)
      const canceled = yield* user.client.generations.cancel({ params: { id: job.id } })
      assert.strictEqual(canceled.status, "canceled")
      assert.isNotNull(canceled.finished_at)
      assert.strictEqual(yield* usedToday(user.client), 0)
      // The runner starts late: the job is no longer queued, so it does nothing.
      start()
      yield* Effect.promise(() => env.settle(job.id))
      assert.strictEqual(env.model.requests.length, 0)
      const after = yield* user.client.generations.get({ params: { id: job.id } })
      assert.strictEqual(after.status, "canceled")
      assert.strictEqual(after.turns, 0)
      // Another user cannot cancel it (the same 404 as a missing job).
      const other = yield* signIn("Not The Owner")
      assert.strictEqual(
        (yield* other.client.generations.cancel({ params: { id: job.id } }).pipe(Effect.flip))._tag,
        "GenerationNotFound",
      )
    }),
  )

  it.effect("a broken AI setting turns generation off and leaves the rest of the API up", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const user = yield* signIn("Settings Victim")
      const broken: ReadonlyArray<Readonly<Record<string, string>>> = [
        { BYOK_KEK: "not base64 at all!" },
        { BYOK_KEK: "c2hvcnQ=" },
        { GENERATION_MODELS: "[{not json" },
        { GENERATION_MODELS: JSON.stringify([{ id: "x", label: "X", provider: "nope" }]) },
        { GENERATION_DAILY_JOBS: "three" },
      ]
      for (const overrides of broken) {
        const app = env.appWith(overrides)
        const call = (path: string, init: RequestInit = {}) =>
          Effect.promise(() => app.handler(new Request(`http://localhost:3000${path}`, init)))
        const feed = yield* call("/api/feeds/new")
        assert.strictEqual(feed.status, 200, JSON.stringify(overrides))
        const me = yield* call("/api/me", { headers: { cookie: user.cookie } })
        assert.strictEqual(me.status, 200, JSON.stringify(overrides))
        const options = yield* call("/api/generations/options", { headers: { cookie: user.cookie } })
        assert.strictEqual(options.status, 503, JSON.stringify(overrides))
        const body: unknown = yield* Effect.promise(() => options.json())
        assert.deepStrictEqual(body, { _tag: "GenerationUnavailable" })
        const create = yield* call("/api/generations", {
          method: "POST",
          headers: {
            cookie: user.cookie,
            "content-type": "application/json",
            origin: "http://localhost:3000",
          },
          body: JSON.stringify({ prompt, lang: "en", model: "claude-test", billing: "platform" }),
        })
        assert.strictEqual(create.status, 503, JSON.stringify(overrides))
        // Reading old jobs still works.
        const list = yield* call("/api/generations", { headers: { cookie: user.cookie } })
        assert.strictEqual(list.status, 200, JSON.stringify(overrides))
        yield* Effect.promise(() => app.dispose())
      }
    }),
  )
})
