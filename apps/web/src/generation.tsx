import {
  type Generation,
  type GenerationDraft,
  GenerationEvent,
  type GenerationId,
  type GenerationStatus,
  type GenerationTool,
  type GenerationUsage,
  type Issue,
} from "@app/api"
import { Badge, type BadgeTone, Button, buttonClass, Spinner, useI18n } from "@app/ui"
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Result, Schema } from "effect"
import { useEffect, useRef, useState } from "react"
import { callApi } from "./api.ts"
import { AlertIcon, CheckCircleIcon } from "./icons.tsx"

// One AI generation job: its live progress (Server-Sent Events from the job's Durable Object, same
// origin, cookie auth), the result, and the usage. Used by /create.

export const generationQuery = (id: GenerationId) =>
  queryOptions({
    queryKey: ["generation", id] as const,
    queryFn: (context) => callApi((client) => client.generations.get({ params: { id } }), context.signal),
    retry: false,
  })

export const generationsKey = ["generations"] as const
export const generationOptionsKey = ["generation-options"] as const

// Models, the platform quota and the user's stored keys (the create page and Settings).
export const generationOptionsQuery = (userId: string) =>
  queryOptions({
    queryKey: [...generationOptionsKey, userId] as const,
    queryFn: (context) => callApi((client) => client.generations.options(), context.signal),
  })

export const isActive = (status: GenerationStatus) => status === "queued" || status === "running"

const statusTone: Record<GenerationStatus, BadgeTone> = {
  queued: "accent",
  running: "accent",
  succeeded: "success",
  failed: "danger",
  canceled: "neutral",
}

export function StatusBadge(props: { readonly status: GenerationStatus }) {
  const { t } = useI18n()
  return <Badge tone={statusTone[props.status]}>{t(`create.status.${props.status}`)}</Badge>
}

const decodeEvent = Schema.decodeUnknownResult(Schema.fromJsonString(GenerationEvent))

type Connection = "connecting" | "open" | "reconnecting" | "closed"

// The job's events, replayed from the start, then live until `done`. EventSource reconnects by
// itself (with Last-Event-ID, so nothing repeats); a stream that ends without `done` belongs to a
// finished job whose log expired, so it is closed once the job row says it is finished.
function useJobEvents(id: GenerationId, finished: boolean, onDone: () => void) {
  const [events, setEvents] = useState<ReadonlyArray<GenerationEvent>>([])
  const [connection, setConnection] = useState<Connection>("connecting")
  const finishedRef = useRef(finished)
  finishedRef.current = finished
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    setEvents([])
    setConnection("connecting")
    let closed = false
    const source = new EventSource(`/api/generations/${id}/events`)
    const close = () => {
      closed = true
      source.close()
      setConnection("closed")
    }
    source.onopen = () => setConnection("open")
    source.onmessage = (message) => {
      const decoded = decodeEvent(message.data)
      if (Result.isFailure(decoded)) return
      const event = decoded.success
      setEvents((previous) => [...previous, event])
      if (event.type === "done") {
        close()
        onDoneRef.current()
      }
    }
    source.onerror = () => {
      if (closed) return
      if (finishedRef.current || source.readyState === EventSource.CLOSED) {
        close()
        return
      }
      setConnection("reconnecting")
    }
    return () => {
      closed = true
      source.close()
    }
  }, [id])

  return { events, connection }
}

type Step =
  | {
      readonly kind: "tool"
      readonly key: string
      readonly tool: GenerationTool
      readonly label: string | null
      readonly state: "running" | "ok" | "issues" | "failed"
      readonly issues: ReadonlyArray<Issue>
      readonly issueCount: number
    }
  | { readonly kind: "text"; readonly key: string; readonly text: string }

// Tool start/end pairs folded into one row each, plus what the model said.
function stepsOf(events: ReadonlyArray<GenerationEvent>): ReadonlyArray<Step> {
  const steps: Array<Step> = []
  events.forEach((event, index) => {
    if (event.type === "text") steps.push({ kind: "text", key: `text-${index}`, text: event.text })
    if (event.type !== "tool") return
    if (event.phase === "start") {
      steps.push({
        kind: "tool",
        key: `tool-${index}`,
        tool: event.tool,
        label: event.label,
        state: "running",
        issues: [],
        issueCount: 0,
      })
      return
    }
    const at = steps.findLastIndex(
      (step) => step.kind === "tool" && step.tool === event.tool && step.state === "running",
    )
    const started = at === -1 ? undefined : steps[at]
    const state = event.ok === true ? "ok" : event.issue_count > 0 ? "issues" : "failed"
    const ended: Step = {
      kind: "tool",
      key: started?.key ?? `tool-${index}`,
      tool: event.tool,
      label: event.label ?? (started?.kind === "tool" ? started.label : null),
      state,
      issues: event.issues,
      issueCount: event.issue_count,
    }
    if (at === -1) steps.push(ended)
    else steps[at] = ended
  })
  return steps
}

function useStepText() {
  const { t } = useI18n()
  return (step: Extract<Step, { kind: "tool" }>) => {
    const label = step.label ?? ""
    switch (step.tool) {
      case "search_concepts":
        return t(step.state === "running" ? "create.step.search.start" : "create.step.search.end", { label })
      case "get_concept":
        return t("create.step.concept", { label })
      case "validate_lesson":
        if (step.state === "running") return t("create.step.validate.start")
        if (step.state === "ok") return t("create.step.validate.ok")
        return step.issueCount > 0
          ? t("create.step.validate.issues", { count: step.issueCount })
          : t("create.step.failed")
      case "save_draft":
        if (step.state === "running") return t("create.step.save.start")
        if (step.state === "ok") return t("create.step.save.ok")
        return step.issueCount > 0 ? t("create.step.save.issues") : t("create.step.failed")
    }
  }
}

function StepIcon(props: { readonly state: Extract<Step, { kind: "tool" }>["state"] }) {
  const { t } = useI18n()
  if (props.state === "running") return <Spinner size="sm" label={t("common.loading")} />
  if (props.state === "ok") {
    return (
      <span className="text-success">
        <CheckCircleIcon />
      </span>
    )
  }
  return (
    <span className={props.state === "issues" ? "text-ink-muted" : "text-danger"}>
      <AlertIcon />
    </span>
  )
}

export function JobPanel(props: { readonly id: GenerationId; readonly onChanged: () => void }) {
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()
  const job = useQuery(generationQuery(props.id))
  const status = job.data?.status
  const finished = status !== undefined && !isActive(status)
  const { events, connection } = useJobEvents(props.id, finished, () => {
    void queryClient.invalidateQueries({ queryKey: generationQuery(props.id).queryKey })
    props.onChanged()
  })
  const stepText = useStepText()
  const [canceling, setCanceling] = useState(false)

  if (job.isPending) {
    return (
      <div className="flex justify-center py-6">
        <Spinner label={t("common.loading")} />
      </div>
    )
  }
  if (job.isError) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-body-sm text-danger">{t("common.error")}</p>
        <Button size="sm" onClick={() => void job.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    )
  }
  const data = job.data
  // While events stream, they are newer than the row.
  const done = events.findLast((event) => event.type === "done")
  const started = events.some((event) => event.type === "status" && event.status === "running")
  const shownStatus: GenerationStatus =
    done?.type === "done" ? done.status : data.status === "queued" && started ? "running" : data.status
  const usageEvent = events.findLast((event) => event.type === "usage")
  const usage = usageEvent?.type === "usage" && isActive(data.status) ? usageEvent.usage : data.usage
  const steps = stepsOf(events)
  const active = isActive(shownStatus)
  const lastEvent = events.at(-1)
  const thinking = active && !(lastEvent?.type === "tool" && lastEvent.phase === "start")

  return (
    <section
      aria-labelledby="job-title"
      className="flex flex-col gap-4 rounded-lg border border-hairline bg-surface-1 p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id="job-title" className="text-body font-semibold text-ink">
            {t("create.job.title")}
          </h2>
          <StatusBadge status={shownStatus} />
        </div>
        {active ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={canceling}
            onClick={() => {
              setCanceling(true)
              void callApi((client) => client.generations.cancel({ params: { id: props.id } }))
                .then(() => {
                  void queryClient.invalidateQueries({ queryKey: generationQuery(props.id).queryKey })
                  props.onChanged()
                })
                .finally(() => setCanceling(false))
            }}
          >
            {t("create.cancel")}
          </Button>
        ) : null}
      </header>

      <div className="flex flex-col gap-1">
        <span className="text-caption font-medium text-ink-tertiary">{t("create.job.topic")}</span>
        <p className="text-body-sm whitespace-pre-wrap text-ink-muted [overflow-wrap:anywhere]">
          {data.prompt}
        </p>
      </div>

      <ol aria-label={t("create.job.title")} aria-live="polite" className="flex flex-col gap-2.5">
        {data.status === "queued" && events.length === 0 ? (
          <li className="flex items-center gap-2 text-body-sm text-ink-subtle">
            <Spinner size="sm" label={t("common.loading")} />
            {t("create.job.waiting")}
          </li>
        ) : null}
        {steps.map((step) =>
          step.kind === "text" ? (
            <li key={step.key} className="pl-6 text-body-sm text-ink-subtle italic [overflow-wrap:anywhere]">
              {step.text}
            </li>
          ) : (
            <li key={step.key} className="flex flex-col gap-1">
              <div className="flex items-start gap-2 text-body-sm text-ink">
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                  <StepIcon state={step.state} />
                </span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{stepText(step)}</span>
              </div>
              {step.issues.length === 0 ? null : (
                <ul className="ml-6 flex flex-col gap-0.5 border-l border-hairline pl-3">
                  {step.issues.map((issue, index) => (
                    <li
                      // biome-ignore lint/suspicious/noArrayIndexKey: issues have no id and never reorder
                      key={index}
                      className="font-mono text-caption text-ink-subtle [overflow-wrap:anywhere]"
                    >
                      {issue.path} [{issue.code}] {issue.message}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ),
        )}
        {thinking && data.status !== "queued" ? (
          <li className="flex items-center gap-2 text-body-sm text-ink-subtle">
            <Spinner size="sm" label={t("common.loading")} />
            {t("create.job.thinking")}
          </li>
        ) : null}
        {!active && events.length === 0 && connection === "closed" ? (
          <li className="text-body-sm text-ink-subtle">{t("create.job.noTranscript")}</li>
        ) : null}
      </ol>
      {active && connection === "reconnecting" ? (
        <p role="status" className="text-caption text-ink-subtle">
          {t("create.job.reconnecting")}
        </p>
      ) : null}

      <Outcome
        job={data}
        status={shownStatus}
        draft={data.draft ?? (done?.type === "done" ? done.draft : null)}
      />
      <UsageLine usage={usage} locale={locale} />
    </section>
  )
}

function Outcome(props: {
  readonly job: Generation
  readonly status: GenerationStatus
  readonly draft: GenerationDraft | null
}) {
  const { t } = useI18n()
  const draft = props.draft
  if (props.status === "succeeded" && draft !== null) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-accent/40 bg-accent/10 p-3">
        <p className="text-body-sm font-medium text-ink [overflow-wrap:anywhere]">{draft.title}</p>
        <p className="text-body-sm text-ink-muted">{t("create.result.hint")}</p>
        <div>
          <Link
            to="/@{$handle}/$slug"
            params={{ handle: draft.owner_handle, slug: draft.slug }}
            className={buttonClass("primary", "md")}
          >
            {t("create.result.open")}
          </Link>
        </div>
      </div>
    )
  }
  if (props.status === "failed") {
    return (
      <div role="alert" className="flex flex-col gap-1 rounded-md border border-danger/40 bg-danger/10 p-3">
        <p className="text-body-sm font-medium text-danger">{t("create.result.failed")}</p>
        {props.job.error === null ? null : (
          <p className="text-body-sm text-ink-muted [overflow-wrap:anywhere]">{props.job.error}</p>
        )}
      </div>
    )
  }
  if (props.status === "canceled")
    return <p className="text-body-sm text-ink-subtle">{t("create.result.canceled")}</p>
  return null
}

function UsageLine(props: { readonly usage: GenerationUsage; readonly locale: string }) {
  const { t } = useI18n()
  const usage = props.usage
  if (usage.input + usage.output + usage.cache_read === 0) return null
  const cost = new Intl.NumberFormat(props.locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(usage.cost_usd)
  return (
    <p className="text-caption text-ink-tertiary">
      {t("create.usage", { input: usage.input, output: usage.output, cached: usage.cache_read, cost })}
    </p>
  )
}
