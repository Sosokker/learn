import type { AdminReport, CommentId } from "@app/api"
import { Badge, Button, Card, EmptyState, useI18n } from "@app/ui"
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import type { Effect } from "effect"
import { useState } from "react"
import { callApi, errorTag } from "../api.ts"
import { formatDate } from "../format.ts"
import { PageSpinner } from "../lesson-view.tsx"
import { NotFound } from "../not-found.tsx"
import { adminReportsKey, adminReportsQuery, commentsKey, meQuery } from "../queries.ts"
import { useViewer } from "../session.ts"

// The moderators' queue of open reports. Shown to admins only; the server answers everyone else's
// requests with a plain 404 anyway, so this page is a convenience, not the check.
export const Route = createFileRoute("/admin/reports")({ component: ReportsPage })

function ReportsPage() {
  const viewer = useViewer()
  const me = useQuery({ ...meQuery(viewer.user?.id ?? ""), enabled: viewer.user !== null })
  if (viewer.pending || (viewer.user !== null && me.isPending)) return <PageSpinner />
  if (me.data?.is_admin !== true) return <NotFound />
  return <Queue />
}

function Queue() {
  const { t } = useI18n()
  const reports = useInfiniteQuery(adminReportsQuery)
  const [status, setStatus] = useState("")
  const items = reports.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t("admin.title")}</h1>
        <p className="text-body-sm text-ink-subtle">{t("admin.description")}</p>
      </header>
      <p role="status" className="text-caption text-ink-subtle empty:hidden">
        {status}
      </p>
      {reports.isPending ? (
        <PageSpinner />
      ) : reports.isError ? (
        <EmptyState
          title={t("admin.loadError")}
          action={
            <Button size="sm" onClick={() => void reports.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState title={t("admin.empty.title")} description={t("admin.empty.description")} />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((report) => (
            <li key={report.id}>
              <ReportCard report={report} onStatus={setStatus} />
            </li>
          ))}
        </ul>
      )}
      {reports.hasNextPage ? (
        <Button
          variant="ghost"
          disabled={reports.isFetchingNextPage}
          onClick={() => void reports.fetchNextPage()}
          className="self-center"
        >
          {t("common.more")}
        </Button>
      ) : null}
    </div>
  )
}

type Action =
  | { readonly kind: "close"; readonly status: "resolved" | "dismissed" }
  | { readonly kind: "hide" | "unhide"; readonly id: CommentId }

function ReportCard(props: { readonly report: AdminReport; readonly onStatus: (message: string) => void }) {
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()
  const { report } = props
  const lesson = report.lesson
  const comment = report.comment
  const [error, setError] = useState<string | null>(null)

  const act = useMutation({
    mutationFn: (action: Action): Promise<unknown> =>
      callApi((client): Effect.Effect<unknown, unknown> => {
        switch (action.kind) {
          case "hide":
            return client.admin.hideComment({ params: { id: action.id } })
          case "unhide":
            return client.admin.unhideComment({ params: { id: action.id } })
          case "close":
            return client.admin.resolve({ params: { id: report.id }, payload: { status: action.status } })
        }
      }),
    onSuccess: (_, action) => {
      setError(null)
      if (action.kind === "close") props.onStatus(t("admin.closed"))
      const lessonId = report.lesson?.id
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: adminReportsKey }),
        lessonId === undefined
          ? undefined
          : queryClient.invalidateQueries({ queryKey: commentsKey(lessonId) }),
      ])
    },
    onError: (failure) => {
      const tag = errorTag(failure)
      setError(tag === "CrossSiteRequest" || tag === "RateLimited" ? t(`error.${tag}`) : t("common.error"))
    },
  })

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2 text-caption text-ink-subtle">
        <Badge tone="accent">{t(`admin.target.${report.target_type}`)}</Badge>
        <Badge>{t(`report.reason.${report.reason}`)}</Badge>
        <span>
          {report.reporter_handle === null
            ? t("admin.reportedByUnknown")
            : t("admin.reportedBy", { handle: report.reporter_handle })}
        </span>
        <span aria-hidden>·</span>
        <time dateTime={new Date(report.created_at).toISOString()}>
          {formatDate(report.created_at, locale)}
        </time>
      </div>
      {report.note === null ? null : (
        <p className="text-body-sm break-words whitespace-pre-wrap text-ink-muted">“{report.note}”</p>
      )}
      {report.target_type === "comment" ? (
        comment === null ? (
          <p className="text-body-sm italic text-ink-tertiary">{t("admin.commentGone")}</p>
        ) : (
          <blockquote className="flex flex-col gap-1 rounded-md border border-hairline bg-surface-1 p-3">
            <span className="text-caption text-ink-subtle">
              @{comment.author_handle ?? "?"} · <code className="font-mono">{comment.anchor}</code>
              {comment.deleted ? ` · ${t("admin.deleted")}` : ""}
              {comment.hidden_by === null ? "" : ` · ${t(`admin.hiddenBy.${comment.hidden_by}`)}`}
            </span>
            <p className="text-body-sm break-words whitespace-pre-wrap text-ink">{comment.body}</p>
          </blockquote>
        )
      ) : null}
      {lesson === null ? (
        <p className="text-body-sm italic text-ink-tertiary">{t("admin.lessonGone")}</p>
      ) : (
        <p className="flex flex-wrap items-center gap-2 text-body-sm text-ink-muted">
          <span className="min-w-0 break-words">
            {report.target_type === "comment" ? t("admin.on", { lesson: lesson.title }) : lesson.title}
          </span>
          <span className="text-caption text-ink-subtle">@{lesson.owner_handle}</span>
          {lesson.deleted ? <Badge tone="danger">{t("admin.deleted")}</Badge> : null}
          {lesson.visibility === "public" ? null : <Badge>{t(`visibility.${lesson.visibility}`)}</Badge>}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {lesson === null || lesson.deleted ? null : (
          <Button
            size="sm"
            variant="ghost"
            render={
              <Link to="/@{$handle}/$slug" params={{ handle: lesson.owner_handle, slug: lesson.slug }} />
            }
          >
            {t("admin.open")}
          </Button>
        )}
        {comment === null || comment.deleted ? null : comment.hidden_by === null ? (
          <Button
            size="sm"
            disabled={act.isPending}
            onClick={() => act.mutate({ kind: "hide", id: comment.id })}
          >
            {t("admin.hide")}
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={act.isPending}
            onClick={() => act.mutate({ kind: "unhide", id: comment.id })}
          >
            {t("admin.unhide")}
          </Button>
        )}
        <Button
          size="sm"
          disabled={act.isPending}
          onClick={() => act.mutate({ kind: "close", status: "resolved" })}
        >
          {t("admin.resolve")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={act.isPending}
          onClick={() => act.mutate({ kind: "close", status: "dismissed" })}
        >
          {t("admin.dismiss")}
        </Button>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}
    </Card>
  )
}
