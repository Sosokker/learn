import {
  type ByokProvider,
  type FeedCursor,
  type GenerationBilling,
  type GenerationId,
  GenerationId as GenerationIdSchema,
  type GenerationModel,
  type GenerationOptions,
  maxGenerationPrompt,
} from "@app/api"
import type { LessonLang } from "@app/domain"
import { Button, buttonClass, Card, cx, EmptyState, Select, Spinner, TextField, useI18n } from "@app/ui"
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { Option, Schema } from "effect"
import { useState } from "react"
import { callApi, errorTag } from "../api.ts"
import { signInWithGoogle } from "../auth.ts"
import { formatDate } from "../format.ts"
import {
  generationOptionsKey,
  generationOptionsQuery,
  generationsKey,
  JobPanel,
  StatusBadge,
} from "../generation.tsx"
import { AlertIcon, SparkIcon } from "../icons.tsx"
import { PageSpinner } from "../lesson-view.tsx"
import { useViewer } from "../session.ts"

const minPrompt = 10

// /create?job=<id>: the form, the job being watched, and the user's recent requests.
export const Route = createFileRoute("/create")({
  validateSearch: (search: Record<string, unknown>): { readonly job?: GenerationId } =>
    Option.match(Schema.decodeUnknownOption(GenerationIdSchema)(search.job), {
      onNone: () => ({}),
      onSome: (job) => ({ job }),
    }),
  component: CreatePage,
})

function CreatePage() {
  const { t } = useI18n()
  const viewer = useViewer()
  const search = Route.useSearch()
  const queryClient = useQueryClient()
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: generationsKey })
    void queryClient.invalidateQueries({ queryKey: generationOptionsKey })
  }
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t("create.title")}</h1>
        <p className="text-body-sm text-ink-subtle">{t("create.description")}</p>
      </header>
      {viewer.pending ? (
        <PageSpinner />
      ) : viewer.user === null ? (
        <EmptyState
          icon={<SparkIcon />}
          title={t("create.signIn.title")}
          description={t("create.signIn.description")}
          action={
            <Button variant="primary" onClick={() => void signInWithGoogle().catch(() => undefined)}>
              {t("auth.signInWithGoogle")}
            </Button>
          }
        />
      ) : (
        <>
          {search.job === undefined ? null : (
            <JobPanel key={search.job} id={search.job} onChanged={refresh} />
          )}
          <CreateForm userId={viewer.user.id} />
          <History userId={viewer.user.id} selected={search.job} />
        </>
      )}
    </div>
  )
}

function CreateForm(props: { readonly userId: string }) {
  const { t, locale } = useI18n()
  const options = useQuery(generationOptionsQuery(props.userId))
  if (options.isPending) {
    return (
      <div className="flex justify-center py-6">
        <Spinner label={t("common.loading")} />
      </div>
    )
  }
  if (options.isError) {
    if (errorTag(options.error) === "GenerationUnavailable") {
      return <EmptyState icon={<AlertIcon />} title={t("create.unavailable")} />
    }
    return (
      <div className="flex items-center gap-3">
        <p className="text-body-sm text-danger">{t("create.loadError")}</p>
        <Button size="sm" onClick={() => void options.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    )
  }
  const first = options.data.models[0]
  if (first === undefined) return <EmptyState title={t("create.noModels")} />
  return <Form userId={props.userId} options={options.data} initialModel={first} initialLang={locale} />
}

type Billing = { readonly available: boolean; readonly note: string }

function Form(props: {
  readonly userId: string
  readonly options: GenerationOptions
  readonly initialModel: GenerationModel
  readonly initialLang: LessonLang
}) {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { options } = props
  const [prompt, setPrompt] = useState("")
  const [lang, setLang] = useState<LessonLang>(props.initialLang)
  const [modelId, setModelId] = useState(props.initialModel.id)
  const model = options.models.find((entry) => entry.id === modelId) ?? props.initialModel
  const [chosen, setChosen] = useState<GenerationBilling | null>(null)
  const [error, setError] = useState<string | null>(null)

  const left = Math.max(0, options.daily_limit - options.used_today)
  const resetTime = new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(
    new Date(options.resets_at),
  )
  const provider = model.provider === "fake" ? undefined : model.provider
  const key = provider === undefined ? undefined : options.keys.find((stored) => stored.provider === provider)
  const providerName = t(`provider.${model.provider}`)
  // The ways this model can be paid for: the platform's daily quota only where the platform has a
  // key for its provider (none at launch), the user's own key wherever the server can store one.
  const offered: ReadonlyArray<GenerationBilling> = [
    ...(model.platform ? (["platform"] as const) : []),
    ...(provider !== undefined && options.byok_enabled ? (["byok"] as const) : []),
  ]
  const billings: Record<GenerationBilling, Billing> = {
    platform:
      left === 0
        ? { available: false, note: t("create.billing.platformNone", { time: resetTime }) }
        : { available: true, note: t("create.billing.platformLeft", { left, limit: options.daily_limit }) },
    byok:
      key === undefined
        ? { available: false, note: t("create.billing.byokMissing", { provider: providerName }) }
        : {
            available: true,
            note: t("create.billing.byokKey", { provider: providerName, last4: key.last4 }),
          },
  }
  // The user's pick while it is possible; otherwise the first one that is.
  const billing: GenerationBilling | null =
    chosen !== null && offered.includes(chosen) && billings[chosen].available
      ? chosen
      : (offered.find((value) => billings[value].available) ?? null)
  const needsKey = offered.includes("byok") && key === undefined && billing === null

  const create = useMutation({
    mutationFn: (payload: {
      readonly prompt: string
      readonly lang: LessonLang
      readonly model: string
      readonly billing: GenerationBilling
    }) => callApi((client) => client.generations.create({ payload })),
    onSuccess: (job) => {
      setPrompt("")
      setError(null)
      void queryClient.invalidateQueries({ queryKey: generationsKey })
      void queryClient.invalidateQueries({ queryKey: generationOptionsKey })
      void navigate({ to: "/create", search: { job: job.id } })
    },
    onError: (failure) => setError(errorText(failure)),
  })

  const errorText = (failure: unknown): string => {
    const tag = errorTag(failure)
    const fields = typeof failure === "object" && failure !== null ? failure : {}
    if (tag === "GenerationQuotaExceeded") {
      const resets = "resets_at" in fields ? fields.resets_at : undefined
      const time =
        typeof resets === "number"
          ? new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(new Date(resets))
          : ""
      return t("create.error.GenerationQuotaExceeded", { limit: options.daily_limit, time })
    }
    if (tag === "GenerationBusy") return t("create.error.GenerationBusy")
    if (tag === "ByokKeyMissing") {
      const missing = "provider" in fields ? fields.provider : undefined
      return t("create.error.ByokKeyMissing", {
        provider:
          typeof missing === "string" && isProvider(missing) ? t(`provider.${missing}`) : providerName,
      })
    }
    if (tag === "PlatformBillingUnavailable")
      return t("create.error.PlatformBillingUnavailable", { model: model.label })
    if (tag === "GenerationUnavailable") return t("create.unavailable")
    if (tag === "InvalidGeneration") {
      const message = "message" in fields ? fields.message : undefined
      return typeof message === "string" ? message : t("common.error")
    }
    if (tag === "Unauthenticated" || tag === "CrossSiteRequest" || tag === "RateLimited")
      return t(`error.${tag}`)
    return t("common.error")
  }

  return (
    <Card>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          const text = prompt.trim()
          if (text.length < minPrompt) return setError(t("create.promptTooShort", { min: minPrompt }))
          if (billing === null) return setError(needsKey ? billings.byok.note : t("create.noBilling"))
          setError(null)
          create.mutate({ prompt: text.slice(0, maxGenerationPrompt).trim(), lang, model: model.id, billing })
        }}
      >
        <TextField
          label={t("create.prompt")}
          name="prompt"
          value={prompt}
          multiline
          onValueChange={(next) => {
            setPrompt(next)
            setError(null)
          }}
          hint={t("create.promptHint", { min: minPrompt, max: maxGenerationPrompt })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label={t("create.lang")}
            value={lang}
            onValueChange={setLang}
            options={[
              { value: "en", label: t("lang.en") },
              { value: "th", label: t("lang.th") },
            ]}
          />
          <Select
            label={t("create.model")}
            value={model.id}
            onValueChange={(next) => {
              setModelId(next)
              setError(null)
            }}
            options={options.models.map((entry) => ({ value: entry.id, label: entry.label }))}
          />
        </div>
        {offered.length === 2 ? (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-dense font-medium text-ink-muted">{t("create.billing")}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {offered.map((value) => (
                <label
                  key={value}
                  className={cx(
                    "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 transition-colors",
                    billing === value
                      ? "border-accent bg-accent/10"
                      : "border-hairline hover:border-hairline-strong",
                    billings[value].available ? null : "cursor-not-allowed opacity-60",
                  )}
                >
                  <input
                    type="radio"
                    name="billing"
                    value={value}
                    checked={billing === value}
                    disabled={!billings[value].available}
                    onChange={() => {
                      setChosen(value)
                      setError(null)
                    }}
                    className="mt-0.5 accent-[var(--color-accent)]"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-body-sm font-medium text-ink">{t(`create.billing.${value}`)}</span>
                    <span className="text-caption text-ink-subtle [overflow-wrap:anywhere]">
                      {billings[value].note}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <KeysLink label={t("create.settingsLink")} />
          </fieldset>
        ) : needsKey ? (
          <div
            role="note"
            className="flex flex-col gap-3 rounded-md border border-hairline-strong bg-surface-2 px-4 py-3"
          >
            <div className="flex flex-col gap-1">
              <p className="text-body-sm font-medium text-ink">
                {t("create.key.missingTitle", { provider: providerName, model: model.label })}
              </p>
              <p className="text-caption text-ink-subtle">
                {t("create.key.missingBody", { provider: providerName })}
              </p>
            </div>
            <Link to="/settings" hash="ai-keys" className={cx(buttonClass("primary", "sm"), "self-start")}>
              {t("create.key.add", { provider: providerName })}
            </Link>
          </div>
        ) : billing === null ? (
          <p className="text-body-sm text-ink-subtle">
            {offered.includes("platform") ? billings.platform.note : t("create.noBilling")}
          </p>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-body-sm text-ink-muted [overflow-wrap:anywhere]">
              {billing === "byok"
                ? t("create.billing.paidWithKey", { provider: providerName, last4: key?.last4 ?? "" })
                : t("create.billing.quotaLine", { left, limit: options.daily_limit })}
            </p>
            {billing === "byok" ? <KeysLink label={t("create.settingsLink")} /> : null}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={create.isPending || billing === null}>
            {create.isPending ? <Spinner size="sm" label={t("common.loading")} /> : <SparkIcon />}
            {t("create.submit")}
          </Button>
        </div>
        <div aria-live="polite">
          {error === null ? null : <p className="text-body-sm text-danger">{error}</p>}
        </div>
      </form>
    </Card>
  )
}

function KeysLink(props: { readonly label: string }) {
  return (
    <Link
      to="/settings"
      hash="ai-keys"
      className="self-start text-caption text-ink-subtle underline underline-offset-2 hover:text-ink"
    >
      {props.label}
    </Link>
  )
}

const providers: ReadonlyArray<ByokProvider> = ["anthropic", "openai", "deepseek"]
const isProvider = (value: string): value is ByokProvider => providers.some((provider) => provider === value)

function History(props: { readonly userId: string; readonly selected: GenerationId | undefined }) {
  const { t, locale } = useI18n()
  const jobs = useInfiniteQuery({
    queryKey: [...generationsKey, props.userId] as const,
    queryFn: (context) =>
      callApi(
        (client) =>
          client.generations.list({
            query: context.pageParam === null ? { limit: 10 } : { limit: 10, cursor: context.pageParam },
          }),
        context.signal,
      ),
    initialPageParam: null as FeedCursor | null,
    getNextPageParam: (page) => page.next_cursor,
  })
  return (
    <section aria-labelledby="history-title" className="flex flex-col gap-3">
      <h2 id="history-title" className="text-body font-semibold text-ink">
        {t("create.history")}
      </h2>
      {jobs.isPending ? (
        <Spinner label={t("common.loading")} />
      ) : jobs.isError ? (
        <div className="flex items-center gap-3">
          <p className="text-body-sm text-danger">{t("common.error")}</p>
          <Button size="sm" onClick={() => void jobs.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : jobs.data.pages[0]?.items.length === 0 ? (
        <p className="text-body-sm text-ink-subtle">{t("create.history.empty")}</p>
      ) : (
        <>
          <ul
            aria-label={t("create.history.label")}
            className="rounded-lg border border-hairline bg-surface-1"
          >
            {jobs.data.pages
              .flatMap((page) => page.items)
              .map((job) => (
                <li key={job.id} className="border-b border-hairline last:border-b-0">
                  <Link
                    to="/create"
                    search={{ job: job.id }}
                    aria-current={props.selected === job.id ? "true" : undefined}
                    className={cx(
                      "flex flex-col gap-1 px-4 py-3 no-underline transition-colors hover:bg-surface-2",
                      props.selected === job.id ? "bg-surface-2" : null,
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <StatusBadge status={job.status} />
                      <span className="text-caption text-ink-tertiary">
                        {formatDate(job.created_at, locale)} · {job.lang.toUpperCase()}
                      </span>
                    </span>
                    <span className="line-clamp-2 text-body-sm text-ink [overflow-wrap:anywhere]">
                      {job.draft?.title ?? job.prompt}
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
          {jobs.hasNextPage ? (
            <div className="flex justify-center">
              <Button size="sm" disabled={jobs.isFetchingNextPage} onClick={() => void jobs.fetchNextPage()}>
                {t("create.history.more")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
