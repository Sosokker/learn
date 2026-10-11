import {
  ByokKeyMissing,
  type ByokProvider,
  CurrentUser,
  defaultPageLimit,
  type FeedCursor,
  type Generation,
  GenerationBilling,
  GenerationBusy,
  type GenerationCreate,
  GenerationId,
  GenerationNotFound,
  type GenerationOptions,
  type GenerationPage,
  GenerationQuotaExceeded,
  GenerationStatus,
  GenerationUnavailable,
  Handle,
  InvalidGeneration,
  LessonId,
  LessonSlug,
  type LessonVersionId,
  Millis,
  PlatformBillingUnavailable,
  UserId,
} from "@app/api"
import { Database, raw, uuidv7 } from "@app/db"
import { LessonLang } from "@app/domain"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { ByokKeys, SealedKeyRow } from "./byok.ts"
import { byokProviderOf, GenerationSettings } from "./generation-settings.ts"
import { after } from "./rows.ts"

// AI lesson generation jobs (ADR 0009, design §6.12). The D1 row is the job's record: status,
// result, usage. The run itself (agent loop, transcript, progress stream) is in the job's Durable
// Object, reached through GenerationRunner.

// Platform seam to the job runner. Production: one Durable Object per job (apps/worker). Tests run
// the same job code in-process.
export class GenerationRunner extends Context.Service<
  GenerationRunner,
  {
    // Starts the job's run; false when the runner could not be reached.
    readonly start: (id: GenerationId) => Effect.Effect<boolean>
    // Asks a running job to stop. The run then finishes the row as canceled.
    readonly cancel: (id: GenerationId) => Effect.Effect<void>
    // The progress stream (text/event-stream), replayed after event `after`.
    readonly events: (id: GenerationId, after: number) => Effect.Effect<Response>
  }
>()("@app/services/GenerationRunner") {}

export interface GenerationUsageTotals {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  // US dollars.
  readonly cost: number
}

// A job as its runner sees it: the row plus its owner. The runner acts for this user only.
export interface JobForRun {
  readonly id: GenerationId
  readonly user: CurrentUser["Service"]
  readonly status: GenerationStatus
  readonly prompt: string
  readonly lang: LessonLang
  readonly model: string
  readonly billing: GenerationBilling
  readonly lessonSlug: string | null
}

export class Generations extends Context.Service<
  Generations,
  {
    readonly options: Effect.Effect<GenerationOptions, GenerationUnavailable, CurrentUser>
    readonly create: (
      input: GenerationCreate,
    ) => Effect.Effect<
      Generation,
      | InvalidGeneration
      | PlatformBillingUnavailable
      | GenerationQuotaExceeded
      | GenerationBusy
      | ByokKeyMissing
      | GenerationUnavailable,
      CurrentUser
    >
    readonly list: (options: {
      readonly cursor?: FeedCursor | undefined
      readonly limit?: number | undefined
    }) => Effect.Effect<GenerationPage, never, CurrentUser>
    // Owner only: another user's job is the same 404 as a missing one.
    readonly get: (id: GenerationId) => Effect.Effect<Generation, GenerationNotFound, CurrentUser>
    readonly cancel: (id: GenerationId) => Effect.Effect<Generation, GenerationNotFound, CurrentUser>
    readonly events: (
      id: GenerationId,
      after: number,
    ) => Effect.Effect<Response, GenerationNotFound, CurrentUser>
  }
>()("@app/services/Generations") {
  static readonly layer = Layer.effect(
    Generations,
    Effect.gen(function* () {
      const db = yield* Database
      const settings = yield* GenerationSettings
      const keys = yield* ByokKeys
      const runner = yield* GenerationRunner
      const jobs = yield* GenerationJobs

      const options = Effect.gen(function* () {
        if (!settings.enabled) return yield* new GenerationUnavailable()
        const user = yield* CurrentUser
        const now = Date.now()
        const used = yield* db
          .query(
            raw(sql`select jobs from generation_usage where user_id = ${user.id} and day = ${utcDay(now)}`),
            JobsRow,
          )
          .pipe(Effect.orDie)
        const result: GenerationOptions = {
          models: settings.publicModels,
          daily_limit: settings.limits.dailyJobs,
          used_today: used[0]?.jobs ?? 0,
          resets_at: nextUtcMidnight(now),
          keys: yield* keys.list,
          byok_enabled: Option.isSome(settings.kek),
        }
        return result
      }).pipe(Effect.withSpan("Generations.options"))

      const owned = Effect.fn("Generations.owned")(function* (id: GenerationId) {
        const user = yield* CurrentUser
        const rows = yield* db
          .query(raw(sql`${selectJob} where j.id = ${id} and j.user_id = ${user.id}`), JobRow)
          .pipe(Effect.orDie)
        const row = rows[0]
        if (row === undefined) return yield* new GenerationNotFound()
        return toGeneration(row)
      })

      const create = Effect.fn("Generations.create")(function* (input: GenerationCreate) {
        if (!settings.enabled) return yield* new GenerationUnavailable()
        const user = yield* CurrentUser
        const entry = settings.models.find((model) => model.id === input.model)
        if (entry === undefined)
          return yield* new InvalidGeneration({ message: `unknown model ${input.model}` })
        // The platform pays only for providers it has a key for (none at launch).
        if (input.billing === "platform" && Option.isNone(settings.platformKey(entry.provider))) {
          return yield* new PlatformBillingUnavailable({ model: entry.id })
        }
        if (input.billing === "byok") {
          const provider = byokProviderOf(entry.provider)
          if (provider === undefined) {
            return yield* new InvalidGeneration({ message: `${entry.label} takes no key of your own` })
          }
          if (!(yield* keys.has(user.id, provider))) return yield* new ByokKeyMissing({ provider })
        }

        const now = Date.now()
        const id = GenerationId.make(uuidv7(now))
        const day = utcDay(now)
        const platform = input.billing === "platform"
        // One transaction: the job goes in only while the user has no active job and, for platform
        // billing, quota left today; the day's counter moves only if it went in.
        yield* db
          .batch([
            raw(sql`insert into generation_job (id, user_id, status, prompt, lang, model, billing, day, created_at)
              select ${id}, ${user.id}, 'queued', ${input.prompt}, ${input.lang}, ${entry.id}, ${input.billing}, ${day}, ${now}
              where not exists (select 1 from generation_job where user_id = ${user.id} and status in ('queued', 'running'))
                ${
                  platform
                    ? sql`and coalesce((select jobs from generation_usage where user_id = ${user.id} and day = ${day}), 0)
                        < ${settings.limits.dailyJobs}`
                    : sql``
                }`),
            ...(platform
              ? [
                  raw(sql`insert into generation_usage (user_id, day, jobs, cost_micros)
                    select ${user.id}, ${day}, 1, 0 where exists (select 1 from generation_job where id = ${id})
                    on conflict (user_id, day) do update set jobs = jobs + 1`),
                ]
              : []),
          ])
          .pipe(Effect.orDie)

        const created = yield* owned(id).pipe(Effect.option)
        if (Option.isNone(created)) {
          const busy = yield* db
            .query(
              raw(
                sql`select id from generation_job where user_id = ${user.id} and status in ('queued', 'running') limit 1`,
              ),
              IdRow,
            )
            .pipe(Effect.orDie)
          if (busy.length > 0) return yield* new GenerationBusy()
          return yield* new GenerationQuotaExceeded({
            limit: settings.limits.dailyJobs,
            resets_at: nextUtcMidnight(now),
          })
        }
        if (!(yield* runner.start(id))) {
          yield* jobs.finish(id, { status: "failed", error: "the job could not start; try again", turns: 0 })
        }
        return yield* owned(id).pipe(Effect.orDie)
      })

      const list = Effect.fn("Generations.list")(function* (options: {
        readonly cursor?: FeedCursor | undefined
        readonly limit?: number | undefined
      }) {
        const user = yield* CurrentUser
        const limit = options.limit ?? defaultPageLimit
        const rows = yield* db
          .query(
            raw(sql`${selectJob} where j.user_id = ${user.id} and ${after(sql`j.created_at`, sql`j.id`, options.cursor)}
              order by j.created_at desc, j.id desc limit ${limit + 1}`),
            JobRow,
          )
          .pipe(Effect.orDie)
        const items = rows.slice(0, limit)
        const last = items.at(-1)
        const page: GenerationPage = {
          items: items.map(toGeneration),
          next_cursor:
            rows.length > limit && last !== undefined ? { at: last.created_at, id: last.id } : null,
        }
        return page
      })

      const cancel = Effect.fn("Generations.cancel")(function* (id: GenerationId) {
        const user = yield* CurrentUser
        const now = Date.now()
        // One conditional UPDATE, so a job that turns from queued to running at the same moment is
        // still canceled. A queued job never started (markRunning only moves queued rows, so it
        // never will): it ends now and its quota comes back. A running job's run sees the status,
        // stops, and finishes the row (usage, finished_at).
        yield* db
          .batch([
            raw(sql`update generation_job set status = 'canceled',
                finished_at = case when started_at is null then ${now} else null end
              where id = ${id} and user_id = ${user.id} and status in ('queued', 'running')`),
            raw(sql`update generation_usage set jobs = jobs - 1
              where user_id = ${user.id}
                and day = (select day from generation_job where id = ${id}) and jobs > 0
                and exists (select 1 from generation_job where id = ${id} and user_id = ${user.id}
                  and billing = 'platform' and status = 'canceled' and started_at is null
                  and finished_at = ${now})`),
          ])
          .pipe(Effect.orDie)
        const current = yield* owned(id)
        // Signal the job's runner whenever it may be running: it stops at once instead of at the
        // end of its current model request. Harmless when it already ended.
        if (current.status === "canceled" && current.finished_at === null) yield* runner.cancel(id)
        return current
      })

      const events = Effect.fn("Generations.events")(function* (id: GenerationId, afterEvent: number) {
        yield* owned(id)
        return yield* runner.events(id, afterEvent)
      })

      return Generations.of({ options, create, list, get: owned, cancel, events })
    }),
  )
}

// The runner's side of the job row. No CurrentUser: the runner is given a job id by the Worker
// that created the job, and acts for the job's owner, read from the row.
export class GenerationJobs extends Context.Service<
  GenerationJobs,
  {
    readonly load: (id: GenerationId) => Effect.Effect<Option.Option<JobForRun>>
    // queued → running. False when the job is no longer queued (canceled before it started).
    readonly markRunning: (id: GenerationId) => Effect.Effect<boolean>
    // The job owner's stored key for a provider, still encrypted (openByokKey decrypts it).
    readonly sealedKey: (
      userId: UserId,
      provider: ByokProvider,
    ) => Effect.Effect<Option.Option<typeof SealedKeyRow.Type>>
    // True when the user canceled the job.
    readonly isCanceled: (id: GenerationId) => Effect.Effect<boolean>
    readonly saveDraft: (
      id: GenerationId,
      draft: { readonly lessonId: LessonId; readonly slug: string; readonly versionId: LessonVersionId },
    ) => Effect.Effect<void>
    // Usage so far (absolute totals), written after every model request.
    readonly progress: (
      id: GenerationId,
      totals: { readonly turns: number; readonly usage: GenerationUsageTotals },
    ) => Effect.Effect<void>
    // Ends the job once: the status (unless the user canceled it; a saved draft is always
    // "succeeded"), the usage when given (left out, the totals progress() saved stay), the day's
    // spend, and the quota back for a platform job that failed before the provider charged anything.
    readonly finish: (
      id: GenerationId,
      result: {
        readonly status: "succeeded" | "failed" | "canceled"
        readonly error: string | null
        readonly turns: number
        readonly usage?: GenerationUsageTotals
      },
    ) => Effect.Effect<void>
  }
>()("@app/services/GenerationJobs") {
  static readonly layer = Layer.effect(
    GenerationJobs,
    Effect.gen(function* () {
      const db = yield* Database

      const load = Effect.fn("GenerationJobs.load")(function* (id: GenerationId) {
        const rows = yield* db
          .query(
            raw(sql`select j.id, j.user_id, j.status, j.prompt, j.lang, j.model, j.billing, j.lesson_slug,
                u.email, u.name, u.image
              from generation_job j join user u on u.id = j.user_id where j.id = ${id}`),
            RunRow,
          )
          .pipe(Effect.orDie)
        return Option.map(
          Option.fromNullishOr(rows[0]),
          (row): JobForRun => ({
            id: row.id,
            user: { id: row.user_id, email: row.email, name: row.name, image: row.image, viaToken: false },
            status: row.status,
            prompt: row.prompt,
            lang: row.lang,
            model: row.model,
            billing: row.billing,
            lessonSlug: row.lesson_slug,
          }),
        )
      })

      const markRunning = Effect.fn("GenerationJobs.markRunning")(function* (id: GenerationId) {
        const rows = yield* db
          .query(
            raw(sql`update generation_job set status = 'running', started_at = ${Date.now()}
              where id = ${id} and status = 'queued' returning id`),
            IdRow,
          )
          .pipe(Effect.orDie)
        return rows.length > 0
      })

      const sealedKey = Effect.fn("GenerationJobs.sealedKey")(function* (
        userId: UserId,
        provider: ByokProvider,
      ) {
        const rows = yield* db
          .query(
            raw(
              sql`select ciphertext, iv, kek_version from byok_key where user_id = ${userId} and provider = ${provider}`,
            ),
            SealedKeyRow,
          )
          .pipe(Effect.orDie)
        return Option.fromNullishOr(rows[0])
      })

      const isCanceled = Effect.fn("GenerationJobs.isCanceled")(function* (id: GenerationId) {
        const rows = yield* db
          .query(raw(sql`select id from generation_job where id = ${id} and status = 'canceled'`), IdRow)
          .pipe(Effect.orDie)
        return rows.length > 0
      })

      const saveDraft = Effect.fn("GenerationJobs.saveDraft")(function* (
        id: GenerationId,
        draft: { readonly lessonId: LessonId; readonly slug: string; readonly versionId: LessonVersionId },
      ) {
        yield* db
          .run(
            raw(sql`update generation_job set lesson_id = ${draft.lessonId}, lesson_slug = ${draft.slug},
              version_id = ${draft.versionId} where id = ${id}`),
          )
          .pipe(Effect.orDie)
      })

      const usageColumns = (turns: number, usage: GenerationUsageTotals) =>
        sql`turns = ${turns}, input_tokens = ${usage.input}, output_tokens = ${usage.output},
          cache_read_tokens = ${usage.cacheRead}, cache_write_tokens = ${usage.cacheWrite},
          cost_micros = ${Math.round(usage.cost * 1e6)}`

      const progress = Effect.fn("GenerationJobs.progress")(function* (
        id: GenerationId,
        totals: { readonly turns: number; readonly usage: GenerationUsageTotals },
      ) {
        yield* db
          .run(
            raw(sql`update generation_job set ${usageColumns(totals.turns, totals.usage)}
              where id = ${id} and finished_at is null`),
          )
          .pipe(Effect.orDie)
      })

      const finish = Effect.fn("GenerationJobs.finish")(function* (
        id: GenerationId,
        result: {
          readonly status: "succeeded" | "failed" | "canceled"
          readonly error: string | null
          readonly turns: number
          readonly usage?: GenerationUsageTotals
        },
      ) {
        const now = Date.now()
        // `finished_at = now` marks this call's own update, so a second finish (an alarm retry)
        // changes nothing and the day's counters move once.
        const finishedNow = sql`exists (select 1 from generation_job where id = ${id} and finished_at = ${now})`
        yield* db
          .batch([
            // A job that saved its draft succeeded, even if the user's cancel landed while it was
            // saving: the lesson exists and the user should see it.
            raw(sql`update generation_job set
                status = case when version_id is not null then 'succeeded'
                  when status in ('queued', 'running') then ${result.status} else status end,
                error = case when version_id is not null then null else ${result.error} end,
                finished_at = ${now}
                ${result.usage === undefined ? sql`` : sql`, ${usageColumns(result.turns, result.usage)}`}
              where id = ${id} and finished_at is null`),
            raw(sql`update generation_usage set cost_micros = cost_micros + (select cost_micros from generation_job where id = ${id})
              where user_id = (select user_id from generation_job where id = ${id})
                and day = (select day from generation_job where id = ${id})
                and ${finishedNow} and exists (select 1 from generation_job where id = ${id} and billing = 'platform')`),
            raw(sql`update generation_usage set jobs = jobs - 1
              where user_id = (select user_id from generation_job where id = ${id})
                and day = (select day from generation_job where id = ${id}) and jobs > 0
                and ${finishedNow}
                and exists (select 1 from generation_job where id = ${id} and billing = 'platform'
                  and status in ('failed', 'canceled') and input_tokens = 0 and output_tokens = 0)`),
          ])
          .pipe(Effect.orDie)
      })

      return GenerationJobs.of({ load, markRunning, sealedKey, isCanceled, saveDraft, progress, finish })
    }),
  )
}

// YYYY-MM-DD in UTC: the quota day.
export const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10)
const nextUtcMidnight = (now: number) => {
  const date = new Date(now)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)
}

// The draft is shown only while its lesson exists (a deleted draft reads as none).
const selectJob = sql`select j.id, j.status, j.prompt, j.lang, j.model, j.billing, j.error, j.turns,
    j.input_tokens, j.output_tokens, j.cache_read_tokens, j.cache_write_tokens, j.cost_micros,
    j.created_at, j.started_at, j.finished_at,
    l.id as draft_id, p.handle as draft_handle, l.slug as draft_slug, l.title as draft_title
  from generation_job j
  left join lesson l on l.id = j.lesson_id and l.deleted_at is null
  left join profile p on p.user_id = l.owner_id`

const JobRow = Schema.Struct({
  id: GenerationId,
  status: GenerationStatus,
  prompt: Schema.String,
  lang: LessonLang,
  model: Schema.String,
  billing: GenerationBilling,
  error: Schema.NullOr(Schema.String),
  turns: Schema.Int,
  input_tokens: Schema.Int,
  output_tokens: Schema.Int,
  cache_read_tokens: Schema.Int,
  cache_write_tokens: Schema.Int,
  cost_micros: Schema.Int,
  created_at: Millis,
  started_at: Schema.NullOr(Millis),
  finished_at: Schema.NullOr(Millis),
  draft_id: Schema.NullOr(LessonId),
  draft_handle: Schema.NullOr(Handle),
  draft_slug: Schema.NullOr(LessonSlug),
  draft_title: Schema.NullOr(Schema.String),
})
type JobRow = typeof JobRow.Type

const toGeneration = (row: JobRow): Generation => ({
  id: row.id,
  status: row.status,
  prompt: row.prompt,
  lang: row.lang,
  model: row.model,
  billing: row.billing,
  draft:
    row.draft_id !== null && row.draft_handle !== null && row.draft_slug !== null && row.draft_title !== null
      ? {
          lesson_id: row.draft_id,
          owner_handle: row.draft_handle,
          slug: row.draft_slug,
          title: row.draft_title,
        }
      : null,
  error: row.error,
  turns: row.turns,
  usage: {
    input: row.input_tokens,
    output: row.output_tokens,
    cache_read: row.cache_read_tokens,
    cache_write: row.cache_write_tokens,
    cost_usd: row.cost_micros / 1e6,
  },
  created_at: row.created_at,
  started_at: row.started_at,
  finished_at: row.finished_at,
})

const RunRow = Schema.Struct({
  id: GenerationId,
  user_id: UserId,
  status: GenerationStatus,
  prompt: Schema.String,
  lang: LessonLang,
  model: Schema.String,
  billing: GenerationBilling,
  lesson_slug: Schema.NullOr(Schema.String),
  email: Schema.String,
  name: Schema.String,
  image: Schema.NullOr(Schema.String),
})
const IdRow = Schema.Struct({ id: Schema.String })
const JobsRow = Schema.Struct({ jobs: Schema.Int })
