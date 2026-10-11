import {
  CurrentUser,
  type GenerationDraft,
  type GenerationEvent,
  type GenerationId,
  type GenerationStatus,
  type GenerationUsage,
  type Issue,
  LessonVersionId,
} from "@app/api"
import { checkLesson, decodeConcept, type LessonSpec, maxLessonBytes } from "@app/domain"
import {
  apiOf,
  byokProviderOf,
  Concepts,
  contentKey,
  GenerationJobs,
  type GenerationProvider,
  GenerationSettings,
  type GenerationUsageTotals,
  isFakeModel,
  type JobForRun,
  kekVersion,
  Lessons,
  type ModelEntry,
  openByokKey,
  Storage,
} from "@app/services"
import { Agent, type AgentEvent } from "@earendil-works/pi-agent-core"
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai"
import { Cause, Effect, Option, Redacted, Result, Schema } from "effect"
import { fakeProvider } from "./fake-provider.ts"
import { piModelOf } from "./models.ts"
import { systemPrompt, userPrompt } from "./prompt.ts"
import { makeTools, type StepDetails, type ToolResult, toolNames } from "./tools.ts"

// One generation job, start to end: the pi agent loop with the fixed tools, limits, usage
// accounting and progress events. Runs inside the job's Durable Object (apps/worker), or
// in-process in tests. The job's user comes from the job row; nothing the model sends can name
// another user.

export interface RunOptions {
  // Appends one progress event (the Durable Object stores it and streams it to the browser).
  readonly emit: (event: GenerationEvent) => Effect.Effect<void>
  // Aborts the run: the user canceled.
  readonly signal: AbortSignal
  // The provider's fetch; tests pass a fake. A fake model (isFakeModel) without one uses the
  // built-in script.
  readonly fetch?: typeof fetch | undefined
  // The wall-clock limit (runTimeoutMs); tests pass a short one.
  readonly timeoutMs?: number | undefined
}

// A run's wall-clock limit, under the 15 minutes a Durable Object alarm handler may take. Waiting
// on the model is not CPU time; this bounds a run that hangs. Past it, the job fails.
export const runTimeoutMs = 10 * 60 * 1000

export type RunServices = GenerationJobs | GenerationSettings | Concepts | Lessons | Storage

// Largest single model response. A lesson is written in one tool call, so this bounds its size.
const maxTokensPerRequest = 32_000
// Shown in the progress stream and stored on the job.
const maxProviderDetail = 160
const maxEventText = 400
const maxIssuesShown = 5
const maxIssuesToModel = 30
// One value for every job: OpenAI routes requests with the same prompt_cache_key to the same
// cache. Not user data.
const cacheSessionId = "learn-lesson-writer"

type Outcome = {
  readonly status: Exclude<GenerationStatus, "queued" | "running">
  readonly error: string | null
  readonly turns: number
  readonly usage: GenerationUsageTotals
  readonly draft?: GenerationDraft | undefined
}

type MutableUsage = { -readonly [K in keyof GenerationUsageTotals]: GenerationUsageTotals[K] }

interface RunState {
  // Model requests so far.
  requests: number
  usage: MutableUsage
  draft: GenerationDraft | undefined
  // The spec validate_lesson last accepted; save_draft with no spec saves it.
  lastValid: LessonSpec | undefined
  // The draft's lesson slug, fixed by the first save.
  slug: string | null
  saved: boolean
  canceled: boolean
  // Why a limit ended the run.
  stop: string | undefined
  // Our own code failed during the run (D1, R2, a bug): the job fails with internalError, and the
  // cause goes to the log only.
  internal: boolean
}

// What the user sees when our side failed. The cause is logged, never stored or streamed.
const internalError = "something went wrong on our side; try again"

const zeroUsage: GenerationUsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }

export const runGeneration = Effect.fn("runGeneration")(function* (id: GenerationId, options: RunOptions) {
  const jobs = yield* GenerationJobs
  const loaded = yield* jobs.load(id)
  if (Option.isNone(loaded)) return
  const job = loaded.value
  // Canceled before it started (or already run): nothing to do.
  if (!(yield* jobs.markRunning(id))) return
  yield* options.emit({ type: "status", status: "running" })

  // Outside runAgent, so a failure there still knows what the provider was paid for.
  const state: RunState = {
    requests: 0,
    usage: { ...zeroUsage },
    draft: undefined,
    lastValid: undefined,
    slug: job.lessonSlug,
    saved: false,
    canceled: false,
    stop: undefined,
    internal: false,
  }
  const outcome = yield* runAgent(job, state, options).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("generation run failed", cause).pipe(
        // The usage so far, never less than progress() saved: the quota is not given back for a
        // job the provider charged for.
        Effect.as<Outcome>({
          status: "failed",
          error: internalError,
          turns: state.requests,
          usage: state.usage,
          draft: state.draft,
        }),
      ),
    ),
  )
  yield* jobs.finish(id, outcome)
  // The row's status: a job the user canceled stays canceled even if the run finished first, and
  // one that saved its draft is done.
  const final = yield* jobs.load(id)
  const status = Option.match(final, { onNone: () => outcome.status, onSome: (row) => row.status })
  yield* options.emit({
    type: "done",
    status,
    draft: outcome.draft ?? null,
    error: status === "succeeded" ? null : outcome.error,
  })
})

// For a run that cannot go on (the Durable Object was evicted mid-run): the job fails with what it
// recorded so far. Returns the row's final status (a job that saved its draft is still done).
export const abandonGeneration = Effect.fn("abandonGeneration")(function* (id: GenerationId, reason: string) {
  const jobs = yield* GenerationJobs
  yield* jobs.finish(id, { status: "failed", error: reason, turns: 0 })
  const row = yield* jobs.load(id)
  return Option.match(row, { onNone: (): GenerationStatus => "failed", onSome: (job) => job.status })
})

const runAgent = Effect.fn("runAgent")(function* (job: JobForRun, state: RunState, options: RunOptions) {
  const settings = yield* GenerationSettings
  const jobs = yield* GenerationJobs
  const concepts = yield* Concepts
  const lessons = yield* Lessons
  const storage = yield* Storage
  const context = yield* Effect.context<RunServices>()
  const run = <A>(effect: Effect.Effect<A, never, RunServices>) => Effect.runPromiseWith(context)(effect)
  // For the callbacks pi awaits (tools, finishTurn, event listeners): a failure of ours is logged
  // and ends the run as an internal error, instead of reaching pi, which would show its text to
  // the model and the user.
  const guarded = <A>(effect: Effect.Effect<A, never, RunServices>, fallback: A) =>
    run(
      effect.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.succeed(fallback)
            : Effect.logError("generation step failed", cause).pipe(
                Effect.andThen(
                  Effect.sync(() => {
                    state.internal = true
                    agent.abort()
                  }),
                ),
                Effect.as(fallback),
              ),
        ),
      ),
    )
  const failedTool: ToolResult = {
    content: [{ type: "text", text: "This tool failed on the server. Stop." }],
    details: { label: null, ok: false, issues: [], issue_count: 0 },
    isError: true,
    terminate: true,
  }

  const fail = (error: string): Outcome => ({ status: "failed", error, turns: 0, usage: zeroUsage })
  const entry = settings.models.find((model) => model.id === job.model)
  if (entry === undefined) return fail(`the model ${job.model} is no longer offered`)

  const apiKey = yield* keyFor(job, entry.provider)
  if (Option.isNone(apiKey)) {
    return fail(
      job.billing === "byok"
        ? "your API key for this provider is missing or could not be read; set it again in Settings"
        : "this model is not available right now",
    )
  }

  const jobIssues = (spec: LessonSpec): Array<Issue> => [
    ...(spec.lang === job.lang
      ? []
      : [{ path: "lang", code: "job", message: `this job writes a "${job.lang}" lesson` }]),
    ...(spec.kind === "guide"
      ? [{ path: "kind", code: "job", message: `kind "guide" is for the site's own guides` }]
      : []),
  ]

  // A spec as the model sent it: an object, or (some models) a JSON string.
  const check = (input: unknown) => {
    const json = typeof input === "string" ? parseJson(input) : Result.succeed(input)
    if (Result.isFailure(json)) {
      return { spec: undefined, issues: [{ path: "$", code: "json", message: json.failure }] }
    }
    const bytes = new TextEncoder().encode(JSON.stringify(json.success)).byteLength
    if (bytes > maxLessonBytes) {
      return {
        spec: undefined,
        issues: [
          {
            path: "$",
            code: "size",
            message: `the lesson is ${bytes} bytes; the limit is ${maxLessonBytes}`,
          },
        ],
      }
    }
    const checked = checkLesson(json.success)
    const issues: Array<Issue> = [...checked.issues]
    if (checked.spec !== undefined) issues.push(...jobIssues(checked.spec))
    return { spec: checked.spec, issues }
  }

  const issuesResult = (label: string | null, issues: ReadonlyArray<Issue>): ToolResult => ({
    content: [
      {
        type: "text",
        text: `${issues.length} issue${issues.length === 1 ? "" : "s"}; fix them and call validate_lesson again:\n${issues
          .slice(0, maxIssuesToModel)
          .map((issue) => `- ${issue.path} [${issue.code}] ${issue.message}`)
          .join(
            "\n",
          )}${issues.length > maxIssuesToModel ? `\n(and ${issues.length - maxIssuesToModel} more)` : ""}`,
      },
    ],
    details: step(label, false, issues),
  })

  const tools = makeTools({
    searchConcepts: ({ q }) =>
      guarded(
        Effect.gen(function* () {
          const hits = yield* concepts.search({ q, limit: 8 })
          // One line per concept, in the lesson's language when it has one.
          const bySlug = new Map<string, (typeof hits)[number]>()
          for (const hit of hits) {
            const seen = bySlug.get(hit.slug)
            if (seen === undefined || (seen.lang !== job.lang && hit.lang === job.lang))
              bySlug.set(hit.slug, hit)
          }
          const lines = [...bySlug.values()].map(
            (hit) =>
              `- ${hit.slug}: ${hit.title} (${hit.kind}${hit.aliases.length > 0 ? `; also ${hit.aliases.slice(0, 3).join(", ")}` : ""})`,
          )
          return textResult(
            lines.length === 0 ? "No shared concept matches. Write local cards." : lines.join("\n"),
            step(q, true, []),
          )
        }),
        failedTool,
      ),
    getConcept: ({ slug }) =>
      guarded(
        Effect.gen(function* () {
          const found = yield* concepts.get(slug).pipe(Effect.option)
          if (Option.isNone(found)) {
            return {
              ...textResult(`No concept "${slug}". Use a slug from search_concepts.`, step(slug, false, [])),
              isError: true,
            }
          }
          const concept = found.value
          const info = concept.langs.find((lang) => lang.lang === job.lang) ?? concept.langs[0]
          const stored =
            info === undefined
              ? Option.none()
              : yield* storage.get(contentKey(info.body_hash)).pipe(Effect.orDie)
          const card = Option.flatMap(stored, (object) => {
            const decoded = parseJson(new TextDecoder().decode(object.body))
            if (Result.isFailure(decoded)) return Option.none()
            return Option.map(Result.getSuccess(decodeConcept(decoded.success)), (spec) => spec.card)
          })
          const summary = {
            slug: concept.slug,
            lang: info?.lang ?? null,
            title: info?.title ?? null,
            kind: info?.kind ?? null,
            aliases: info?.aliases ?? [],
            needs: concept.needs,
            body: Option.match(card, { onNone: () => null, onSome: (value) => value.body.slice(0, 1200) }),
          }
          return textResult(JSON.stringify(summary), step(slug, true, []))
        }),
        failedTool,
      ),
    validateLesson: ({ spec }) =>
      guarded(
        Effect.sync(() => {
          const checked = check(spec)
          const label = checked.spec?.title ?? null
          if (checked.issues.length > 0 || checked.spec === undefined)
            return issuesResult(label, checked.issues)
          state.lastValid = checked.spec
          return textResult("Valid. Call save_draft with no arguments to save it.", step(label, true, []))
        }),
        failedTool,
      ),
    saveDraft: ({ spec }) =>
      guarded(
        Effect.gen(function* () {
          const checked = spec === undefined ? { spec: state.lastValid, issues: [] } : check(spec)
          const target = checked.spec
          if (target === undefined && checked.issues.length === 0) {
            return {
              ...textResult(
                "Nothing validated yet: call validate_lesson first, or pass spec.",
                step(null, false, []),
              ),
              isError: true,
            }
          }
          if (target === undefined || checked.issues.length > 0)
            return issuesResult(target?.title ?? null, checked.issues)
          const slug = state.slug ?? draftSlug(target.title, job.id)
          const published = yield* lessons
            .publish(slug, new TextEncoder().encode(JSON.stringify(target)))
            .pipe(Effect.provideService(CurrentUser, job.user), Effect.result)
          if (Result.isFailure(published)) {
            const failure = published.failure
            return issuesResult(
              target.title,
              failure._tag === "InvalidLesson"
                ? failure.issues
                : [{ path: "$", code: "size", message: `the lesson is over ${failure.max_bytes} bytes` }],
            )
          }
          const saved = published.success
          state.slug = slug
          state.saved = true
          state.draft = {
            lesson_id: saved.lesson.id,
            owner_handle: saved.lesson.owner_handle,
            slug: saved.lesson.slug,
            title: saved.lesson.title,
          }
          yield* jobs.saveDraft(job.id, {
            lessonId: saved.lesson.id,
            slug,
            versionId: LessonVersionId.make(saved.version.id),
          })
          return {
            ...textResult(
              `Saved as the user's private draft (version ${saved.version.n}). You are done; stop now.`,
              step(target.title, true, []),
            ),
            terminate: true,
          }
        }),
        failedTool,
      ),
  })

  const { model, stream } = piModelOf(entry)
  const providerFetch = isFakeModel(entry) ? (options.fetch ?? fakeProvider()) : options.fetch
  const key = Redacted.value(apiKey.value)
  // Platform runs share one cached prefix (tools + system) for an hour; a user's own key gets the
  // cheaper 5-minute write (its cache is that user's alone).
  const retention = job.billing === "platform" ? "long" : "short"
  const longPrefix = retention === "long" && apiOf(entry) === "anthropic-messages"

  const agent = new Agent({
    initialState: { systemPrompt, model, tools: [...tools] },
    toolExecution: "sequential",
    streamFn: (streamModel, streamContext, streamOptions) =>
      stream(streamModel, streamContext, {
        ...streamOptions,
        // Explicit, so pi never looks for a key or a retention in the environment.
        apiKey: key,
        cacheRetention: retention,
        sessionId: cacheSessionId,
        // pi marks the conversation tail with the prefix's retention. The tail changes every
        // request and is read back within seconds, so a 1-hour write (2x input) there is waste:
        // it gets the 5-minute one (1.25x). Anthropic accepts 1h marks before 5m ones.
        ...(longPrefix ? { onPayload: shortTail } : {}),
        maxTokens: Math.max(
          1,
          Math.min(
            entry.max_tokens,
            maxTokensPerRequest,
            settings.limits.maxOutputTokens - state.usage.output,
          ),
        ),
        ...(providerFetch === undefined ? {} : { fetch: providerFetch }),
      }),
    finishTurn: () =>
      guarded(
        Effect.gen(function* () {
          yield* jobs.progress(job.id, { turns: state.requests, usage: state.usage })
          if (state.saved || state.internal) return end
          if (yield* jobs.isCanceled(job.id)) {
            state.canceled = true
            return end
          }
          if (state.requests >= settings.limits.maxTurns) {
            state.stop = `stopped after ${state.requests} model requests without a valid lesson`
            return end
          }
          if (state.usage.output >= settings.limits.maxOutputTokens) {
            state.stop = "the job's output token budget is used up"
            return end
          }
          return undefined
        }),
        end,
      ),
  })

  agent.subscribe((event) => guarded(onEvent(event), undefined))
  const onEvent = (event: AgentEvent): Effect.Effect<void> => {
    switch (event.type) {
      case "turn_start":
        state.requests += 1
        return options.emit({ type: "turn", n: state.requests })
      case "message_end": {
        const message = event.message
        if (!isAssistant(message)) return Effect.void
        addUsage(state.usage, message.usage, entry, longPrefix)
        const text = message.content
          .map((block) => (block.type === "text" ? block.text : ""))
          .join("")
          .trim()
        return Effect.andThen(
          options.emit({ type: "usage", usage: wireUsage(state.usage) }),
          text === "" ? Effect.void : options.emit({ type: "text", text: text.slice(0, maxEventText) }),
        )
      }
      case "tool_execution_start": {
        const tool = toolNames.find((name) => name === event.toolName)
        if (tool === undefined) return Effect.void
        return options.emit({
          type: "tool",
          tool,
          phase: "start",
          label: labelOf(event.args),
          ok: null,
          issues: [],
          issue_count: 0,
        })
      }
      case "tool_execution_end": {
        const tool = toolNames.find((name) => name === event.toolName)
        if (tool === undefined) return Effect.void
        const details = detailsOf(event.result)
        return options.emit({
          type: "tool",
          tool,
          phase: "end",
          label: details?.label ?? null,
          ok: details?.ok ?? !event.isError,
          issues: (details?.issues ?? []).slice(0, maxIssuesShown),
          issue_count: details?.issue_count ?? 0,
        })
      }
      default:
        return Effect.void
    }
  }

  // The user's cancel, or the wall-clock limit.
  const timeout = AbortSignal.timeout(options.timeoutMs ?? runTimeoutMs)
  const signal = AbortSignal.any([options.signal, timeout])
  if (signal.aborted) return { status: "canceled", error: null, turns: 0, usage: zeroUsage } satisfies Outcome
  const abort = () => agent.abort()
  signal.addEventListener("abort", abort)
  yield* Effect.promise(() => agent.prompt(userPrompt(job.prompt, job.lang))).pipe(
    Effect.ensuring(Effect.sync(() => signal.removeEventListener("abort", abort))),
  )

  const base = { turns: state.requests, usage: state.usage, draft: state.draft }
  if (state.saved) return { ...base, status: "succeeded", error: null } satisfies Outcome
  if (state.internal) return { ...base, status: "failed", error: internalError } satisfies Outcome
  if (state.canceled || options.signal.aborted)
    return { ...base, status: "canceled", error: null } satisfies Outcome
  if (timeout.aborted) {
    return {
      ...base,
      status: "failed",
      error: `timed out after ${Math.round((options.timeoutMs ?? runTimeoutMs) / 60_000)} minutes without a saved lesson`,
    } satisfies Outcome
  }
  if (state.stop !== undefined) return { ...base, status: "failed", error: state.stop } satisfies Outcome
  const error = agent.state.errorMessage
  if (error !== undefined) {
    yield* Effect.logWarning("generation model request failed", error)
    return { ...base, status: "failed", error: providerError(error, job.billing) } satisfies Outcome
  }
  return { ...base, status: "failed", error: "the model stopped without saving a lesson" } satisfies Outcome
})

const end = { action: "end" } as const

// The provider key of a run: the platform's, or the job owner's own (decrypted only here).
const keyFor = Effect.fn("keyFor")(function* (job: JobForRun, provider: GenerationProvider) {
  const settings = yield* GenerationSettings
  if (job.billing === "platform") return settings.platformKey(provider)
  const slot = byokProviderOf(provider)
  const kek = settings.kek
  if (slot === undefined || Option.isNone(kek)) return Option.none()
  const jobs = yield* GenerationJobs
  const sealed = yield* jobs.sealedKey(job.user.id, slot)
  // Sealed with a KEK this server no longer has: the user sets the key again.
  if (Option.isNone(sealed) || sealed.value.kek_version !== kekVersion) return Option.none()
  return yield* Effect.tryPromise(() => openByokKey(kek.value, job.user.id, slot, sealed.value)).pipe(
    Effect.map((key) => Option.some(Redacted.make(key))),
    Effect.catch(() => Effect.succeed(Option.none<Redacted.Redacted<string>>())),
  )
})

// `<words of the title>-<6 characters of the job id>`: unique per job, so a draft never lands in
// another lesson of the user. Thai titles have no Latin words: `lesson-<…>`.
export const draftSlug = (title: string, id: string) => {
  const words = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .slice(0, 60)
    .replace(/-+$/u, "")
  return `${words === "" ? "lesson" : words}-${id.replace(/-/gu, "").slice(-6)}`
}

const step = (label: string | null, ok: boolean, issues: ReadonlyArray<Issue>): StepDetails => ({
  label: label === null ? null : label.slice(0, 120),
  ok,
  issues: issues.slice(0, maxIssuesShown),
  issue_count: issues.length,
})

const textResult = (text: string, details: StepDetails): ToolResult => ({
  content: [{ type: "text", text }],
  details,
})

const decodeJson = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown))
const parseJson = (text: string): Result.Result<unknown, string> =>
  Result.mapError(decodeJson(text), (error) => `not JSON: ${error.message}`)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isAssistant = (message: unknown): message is AssistantMessage =>
  isRecord(message) && message.role === "assistant"

// A step's label from the model's arguments: the search words, the slug, or the lesson title.
const labelOf = (args: unknown): string | null => {
  if (!isRecord(args)) return null
  if (typeof args.q === "string") return args.q.slice(0, 120)
  if (typeof args.slug === "string") return args.slug.slice(0, 120)
  const spec = typeof args.spec === "string" ? Result.getOrUndefined(parseJson(args.spec)) : args.spec
  return isRecord(spec) && typeof spec.title === "string" ? spec.title.slice(0, 120) : null
}

const detailsOf = (result: unknown): StepDetails | undefined => {
  if (!isRecord(result) || !isRecord(result.details)) return undefined
  const details = result.details
  return typeof details.ok === "boolean" &&
    Array.isArray(details.issues) &&
    typeof details.issue_count === "number"
    ? {
        label: typeof details.label === "string" ? details.label : null,
        ok: details.ok,
        issues: details.issues.filter(
          (issue): issue is Issue =>
            isRecord(issue) &&
            typeof issue.path === "string" &&
            typeof issue.code === "string" &&
            typeof issue.message === "string",
        ),
        issue_count: details.issue_count,
      }
    : undefined
}

const addUsage = (total: MutableUsage, usage: Usage, entry: ModelEntry, longPrefix: boolean) => {
  total.input += usage.input
  total.output += usage.output
  total.cacheRead += usage.cacheRead
  total.cacheWrite += usage.cacheWrite
  total.cost += costOf(entry, usage, longPrefix)
}

// US dollars of one response, from the model's configured prices (not pi's): 1-hour cache writes
// at cache_write_1h. Anthropic reports the 1-hour part of the writes; when it does not, a run that
// asked for 1-hour writes counts them all as 1-hour (never less than the bill).
export const costOf = (entry: ModelEntry, usage: Usage, longPrefix: boolean) => {
  const price = entry.cost
  const long = Math.min(usage.cacheWrite, usage.cacheWrite1h ?? (longPrefix ? usage.cacheWrite : 0))
  return (
    (usage.input * price.input +
      usage.output * price.output +
      usage.cacheRead * price.cache_read +
      (usage.cacheWrite - long) * price.cache_write +
      long * (price.cache_write_1h ?? price.cache_write)) /
    1e6
  )
}

// An Anthropic request with every cache mark in the messages (the conversation tail) set to the
// default 5-minute retention. The tools and system keep theirs.
export const shortTail = (payload: unknown): unknown => {
  if (!isRecord(payload) || !Array.isArray(payload.messages)) return undefined
  return {
    ...payload,
    messages: payload.messages.map((message: unknown) =>
      isRecord(message) && Array.isArray(message.content)
        ? {
            ...message,
            content: message.content.map((block: unknown) =>
              isRecord(block) && isRecord(block.cache_control)
                ? { ...block, cache_control: { type: "ephemeral" } }
                : block,
            ),
          }
        : message,
    ),
  }
}

// What the user reads when the provider refused a request: the HTTP status in plain words, and
// the provider's own short message. Anything else (a network failure, text we do not recognize)
// gets a general message; the full text goes to the log only.
export const providerError = (message: string, billing: "platform" | "byok") => {
  // pi's provider errors start with the HTTP status ("401 {…}", "429: {…}").
  const status = Number(/^(\d{3})\b/u.exec(message)?.[1])
  const detail = providerDetail(message)
  const why = detail === undefined ? `${status}` : `${status}: ${detail}`
  if (status === 401 || status === 403) {
    return billing === "byok"
      ? `the provider refused your API key (${why}). Check it in Settings.`
      : `the provider refused the request (${why}). Try again later.`
  }
  if (status === 429)
    return `the provider is rate limiting this key or it is out of credit (${why}). Try again later.`
  if (status === 400 || status === 404 || status === 413 || status === 422)
    return `the provider refused the request (${why}).`
  if (status >= 500 && status <= 599) return `the provider had an error (${why}). Try again later.`
  return "the model request failed. Try again later."
}

// The "message" of a provider's JSON error body, shortened.
const providerDetail = (message: string): string | undefined => {
  const found = /"message"\s*:\s*"((?:[^"\\]|\\.){1,400})"/u.exec(message)?.[1]
  return found === undefined ? undefined : found.replace(/\\(.)/gu, "$1").slice(0, maxProviderDetail)
}

const wireUsage = (usage: GenerationUsageTotals): GenerationUsage => ({
  input: usage.input,
  output: usage.output,
  cache_read: usage.cacheRead,
  cache_write: usage.cacheWrite,
  cost_usd: usage.cost,
})
