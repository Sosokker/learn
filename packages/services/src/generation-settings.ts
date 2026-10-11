import type { ByokProvider, GenerationModel } from "@app/api"
import { Config, ConfigProvider, Context, Effect, Layer, Option, Redacted, Schema } from "effect"

// Server settings of AI lesson generation (ADR 0009): the models offered, the platform's provider
// keys, the limits, and the key that encrypts users' own keys. All from the Worker's vars and
// secrets, read once when the Worker (or a job's Durable Object) starts.

export const GenerationProvider = Schema.Literals(["anthropic", "openai", "deepseek", "fake"])
export type GenerationProvider = typeof GenerationProvider.Type

// The pi-ai stream module a provider speaks. DeepSeek and OpenAI use Chat Completions; `fake`
// (dev and test only) answers in Anthropic's format from an in-process script, no network.
export const ModelApi = Schema.Literals(["anthropic-messages", "openai-completions"])
export type ModelApi = typeof ModelApi.Type

const price = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

// One entry of GENERATION_MODELS (a JSON array). Prices are US dollars per million tokens.
export const ModelEntry = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]{0,79}$/u)),
  label: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  provider: GenerationProvider,
  // The provider's model id (`claude-sonnet-5-5`).
  model: Schema.String.check(Schema.isMinLength(1)),
  api: Schema.optionalKey(ModelApi),
  // Defaults per provider (defaultBaseUrls).
  base_url: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^https?:\/\/\S+$/u))),
  context_window: Schema.Int.check(Schema.isGreaterThan(0)),
  max_tokens: Schema.Int.check(Schema.isGreaterThan(0)),
  // `cache_write` is the 5-minute cache write; `cache_write_1h` the 1-hour one (Anthropic: 2x
  // input), used for the tokens the provider reports as 1-hour writes. Defaults to cache_write.
  cost: Schema.Struct({
    input: price,
    output: price,
    cache_read: price,
    cache_write: price,
    cache_write_1h: Schema.optionalKey(price),
  }),
  // Dev and test only: requests go to the in-process scripted model (fake-provider.ts) instead of
  // the provider, but the entry keeps its provider's key slot and wire format, so the BYOK flow
  // can be tried locally without a real key.
  fake: Schema.optionalKey(Schema.Boolean),
})
export type ModelEntry = typeof ModelEntry.Type

// Whether a model's requests go to the scripted model.
export const isFakeModel = (entry: ModelEntry) => entry.provider === "fake" || entry.fake === true

export const defaultBaseUrls: Readonly<Record<GenerationProvider, string>> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
  fake: "https://fake-provider.invalid",
}

export const apiOf = (entry: ModelEntry): ModelApi =>
  entry.api ??
  (entry.provider === "anthropic" || entry.provider === "fake" ? "anthropic-messages" : "openai-completions")

export interface GenerationLimits {
  // Platform-paid jobs per user per UTC day.
  readonly dailyJobs: number
  // Model requests per job.
  readonly maxTurns: number
  // Output tokens per job, over all its requests.
  readonly maxOutputTokens: number
}

export class GenerationSettings extends Context.Service<
  GenerationSettings,
  {
    // False when the settings could not be read (a bad BYOK_KEK or GENERATION_MODELS): AI
    // generation is off, with no models and no keys, and the rest of the API still works.
    readonly enabled: boolean
    readonly models: ReadonlyArray<ModelEntry>
    readonly limits: GenerationLimits
    // The platform's key for a provider, if it has one. `fake` needs none (always some).
    readonly platformKey: (provider: GenerationProvider) => Option.Option<Redacted.Redacted<string>>
    // AES-GCM key from BYOK_KEK; none disables storing users' keys.
    readonly kek: Option.Option<CryptoKey>
    // What the create page shows.
    readonly publicModels: ReadonlyArray<GenerationModel>
  }
>()("@app/services/GenerationSettings") {
  // Never fails: broken settings turn generation off (logged once, when the layer is built) instead
  // of failing every route of the Worker that is built on this layer.
  static readonly layer = Layer.effect(
    GenerationSettings,
    Effect.gen(function* () {
      const appEnv = yield* Config.Literals(["dev", "test", "deployed"], "APP_ENV").pipe(
        Config.withDefault("deployed"),
      )
      const models = yield* Config.schema(
        Schema.fromJsonString(Schema.Array(ModelEntry)),
        "GENERATION_MODELS",
      ).pipe(Config.withDefault<ReadonlyArray<ModelEntry>>([]))
      if (appEnv === "deployed" && models.some(isFakeModel)) {
        return yield* configError("GENERATION_MODELS: the fake provider is for dev and test only")
      }
      const ids = new Set(models.map((model) => model.id))
      if (ids.size !== models.length) return yield* configError("GENERATION_MODELS: model ids must be unique")

      const keys: Record<Exclude<GenerationProvider, "fake">, Option.Option<Redacted.Redacted<string>>> = {
        anthropic: yield* optionalSecret("ANTHROPIC_API_KEY"),
        openai: yield* optionalSecret("OPENAI_API_KEY"),
        deepseek: yield* optionalSecret("DEEPSEEK_API_KEY"),
      }
      const platformKey = (provider: GenerationProvider) =>
        provider === "fake" ? Option.some(Redacted.make("fake")) : keys[provider]

      const limits: GenerationLimits = {
        dailyJobs: yield* Config.Int("GENERATION_DAILY_JOBS").pipe(Config.withDefault(3)),
        maxTurns: yield* Config.Int("GENERATION_MAX_TURNS").pipe(Config.withDefault(12)),
        maxOutputTokens: yield* Config.Int("GENERATION_MAX_OUTPUT_TOKENS").pipe(Config.withDefault(60_000)),
      }

      const kekText = yield* optionalSecret("BYOK_KEK")
      if (
        appEnv === "deployed" &&
        Option.exists(kekText, (secret) => Redacted.value(secret).trim() === devByokKek)
      ) {
        return yield* configError("BYOK_KEK is the public dev value. Generate one: openssl rand -base64 32")
      }
      const kek = yield* Option.match(kekText, {
        onNone: () => Effect.succeed(Option.none<CryptoKey>()),
        onSome: (secret) => importKek(Redacted.value(secret)).pipe(Effect.map(Option.some)),
      })

      const publicModels = models.map(
        (model): GenerationModel => ({
          id: model.id,
          label: model.label,
          provider: model.provider,
          platform: Option.isSome(platformKey(model.provider)),
        }),
      )
      return GenerationSettings.of({ enabled: true, models, limits, platformKey, kek, publicModels })
    }).pipe(
      Effect.catchTag("ConfigError", (error) =>
        Effect.logError("AI generation is off: its settings are invalid", error.message).pipe(
          Effect.as(disabledSettings),
        ),
      ),
    ),
  )
}

const disabledSettings = GenerationSettings.of({
  enabled: false,
  models: [],
  limits: { dailyJobs: 0, maxTurns: 0, maxOutputTokens: 0 },
  platformKey: () => Option.none(),
  kek: Option.none(),
  publicModels: [],
})

// .dev.vars.example's BYOK_KEK: public, refused when APP_ENV is deployed.
export const devByokKek = "fOI5sfBnXsVUY4kU6fN5xGq3x1y3wC0v7m7l2y0Q1Qc="

// A key slot a user can fill: every provider but `fake`.
export const byokProviderOf = (provider: GenerationProvider): ByokProvider | undefined =>
  provider === "fake" ? undefined : provider

const optionalSecret = (name: string) =>
  Config.option(Config.Redacted(name)).pipe(
    // An empty value (a blank line in .dev.vars) means unset.
    Config.map(Option.filter((secret) => Redacted.value(secret).trim() !== "")),
  )

const configError = (message: string) =>
  Effect.fail(new Config.ConfigError(new ConfigProvider.SourceError({ message })))

// BYOK_KEK: 32 random bytes, base64 (openssl rand -base64 32).
const importKek = (text: string) =>
  Effect.gen(function* () {
    const bytes = yield* Effect.try({
      try: () => Uint8Array.from(atob(text.trim()), (char) => char.charCodeAt(0)),
      catch: () =>
        new Config.ConfigError(new ConfigProvider.SourceError({ message: "BYOK_KEK is not base64" })),
    })
    if (bytes.byteLength !== 32)
      return yield* configError("BYOK_KEK must be 32 bytes (openssl rand -base64 32)")
    return yield* Effect.promise(() =>
      crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]),
    )
  })
