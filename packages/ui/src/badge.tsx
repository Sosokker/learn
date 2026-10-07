import type { ReactNode } from "react"
import { cx } from "./cx.ts"

export type BadgeTone = "neutral" | "accent" | "success" | "danger"

const tones: Record<BadgeTone, string> = {
  neutral: "border-hairline-strong text-ink-subtle",
  accent: "border-accent/40 bg-accent/10 text-accent-hover",
  success: "border-success/40 bg-success/10 text-success",
  danger: "border-danger/40 bg-danger/10 text-danger",
}

// A small status label (visibility, lesson kind, "New"). Text says the status; color only backs it.
export function Badge(props: {
  readonly children: ReactNode
  readonly tone?: BadgeTone
  readonly icon?: ReactNode
  readonly className?: string
}) {
  return (
    <span
      className={cx(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border px-1.5 text-caption font-medium whitespace-nowrap",
        tones[props.tone ?? "neutral"],
        props.className,
      )}
    >
      {props.icon}
      {props.children}
    </span>
  )
}

// A topic tag on a lesson row, Linear label style: a dot and the name on a pill. Wrap it in a
// link in the app when tags are clickable.
export function Tag(props: { readonly children: ReactNode; readonly className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border border-hairline px-2 text-caption text-ink-subtle whitespace-nowrap",
        props.className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-ink-tertiary" />
      {props.children}
    </span>
  )
}
