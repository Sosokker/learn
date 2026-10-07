import type { ComponentProps, ReactNode } from "react"
import { cn } from "./cn.ts"
import { CloseIcon } from "./icons.tsx"

export type BadgeTone = "neutral" | "accent" | "success" | "danger"

const tones: Record<BadgeTone, string> = {
  neutral: "border-hairline bg-surface-2 text-ink-muted",
  accent: "border-primary/40 bg-primary/10 text-primary-hover",
  success: "border-success/40 bg-success/10 text-success",
  danger: "border-danger/40 bg-danger/10 text-danger",
}

export interface BadgeProps extends ComponentProps<"span"> {
  tone?: BadgeTone
  icon?: ReactNode
}

// Status pill: visibility, "owner", counts.
export function Badge({ tone = "neutral", icon, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-xs border px-1.5 text-caption leading-none font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  )
}

export interface ChipProps extends ComponentProps<"span"> {
  // Shows a remove button when set.
  onRemove?: () => void
  removeLabel?: string
}

// Tag chip. Plain text, no color: tags are labels, not roles.
export function Chip({ onRemove, removeLabel, className, children, ...props }: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-40 shrink-0 items-center gap-0.5 rounded-sm border border-hairline bg-surface-1 px-1.5 text-caption leading-none text-ink-subtle",
        className,
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="-mr-1 inline-flex size-4 cursor-pointer items-center justify-center rounded-xs text-ink-tertiary hover:bg-surface-3 hover:text-ink"
        >
          <CloseIcon className="size-3" />
        </button>
      ) : null}
    </span>
  )
}
