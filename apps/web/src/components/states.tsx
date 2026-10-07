import { AlertIcon, Button, Skeleton, useT } from "@app/ui"
import type { ReactNode } from "react"
import { errorMessage } from "../lib/api.ts"

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode
  title: string
  body?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      {icon ? (
        <div className="mb-1 flex size-10 items-center justify-center rounded-lg border border-hairline bg-surface-1 text-ink-subtle">
          {icon}
        </div>
      ) : null}
      <p className="text-body-sm font-medium text-ink">{title}</p>
      {body ? <p className="max-w-sm text-dense text-ink-subtle">{body}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}

export function ErrorState({
  error,
  onRetry,
  title,
}: {
  error: unknown
  onRetry?: () => void
  title?: string
}) {
  const t = useT()
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <div className="mb-1 flex size-10 items-center justify-center rounded-lg border border-hairline bg-surface-1 text-danger">
        <AlertIcon />
      </div>
      <p className="text-body-sm font-medium text-ink">{title ?? t("error.title")}</p>
      <p className="max-w-sm text-dense text-ink-subtle">{errorMessage(t, error)}</p>
      {onRetry ? (
        <Button className="mt-3" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      ) : null}
    </div>
  )
}

// Same height as a LessonRow, so the list doesn't jump when data arrives.
export function RowSkeletons({ count = 6 }: { count?: number }) {
  const t = useT()
  return (
    <div role="status" aria-label={t("common.loading")}>
      {Array.from({ length: count }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
          key={i}
          className="flex h-11 items-center gap-3 border-b border-hairline px-6 max-md:h-[60px] max-md:px-4"
        >
          <Skeleton className="size-4 rounded-xs" />
          <Skeleton className="h-3 rounded-xs" style={{ width: `${30 + ((i * 17) % 35)}%` }} />
          <div className="flex-1" />
          <Skeleton className="h-3 w-20 rounded-xs max-md:hidden" />
          <Skeleton className="h-3 w-10 rounded-xs max-md:hidden" />
        </div>
      ))}
    </div>
  )
}
