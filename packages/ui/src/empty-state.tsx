import type { ReactNode } from "react"
import { cx } from "./cx.ts"

// What a list shows when it has nothing: what is missing, why, and the next step (`action`).
export function EmptyState(props: {
  readonly title: string
  readonly description?: ReactNode
  readonly icon?: ReactNode
  readonly action?: ReactNode
  readonly className?: string
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed border-hairline px-6 py-12 text-center",
        props.className,
      )}
    >
      {props.icon === undefined ? null : (
        <div
          aria-hidden
          className="flex size-10 items-center justify-center rounded-lg border border-hairline bg-surface-1 text-ink-subtle"
        >
          {props.icon}
        </div>
      )}
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-body-sm font-medium text-ink">{props.title}</p>
        {props.description === undefined ? null : (
          <p className="text-body-sm text-ink-subtle">{props.description}</p>
        )}
      </div>
      {props.action === undefined ? null : <div className="mt-1">{props.action}</div>}
    </div>
  )
}
