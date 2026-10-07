import type { ComponentProps } from "react"
import { cn } from "./cn.ts"

// Level-1 lift: surface-1 on canvas with a hairline. No shadow.
export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-lg border border-hairline bg-surface-1", className)} {...props} />
}

// A card with the standard 24px (16px on phones) inner padding.
export function Panel({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn("rounded-lg border border-hairline bg-surface-1 p-6 max-md:p-4", className)}
      {...props}
    />
  )
}

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div aria-hidden="true" className={cn("animate-pulse rounded-sm bg-surface-3", className)} {...props} />
  )
}

export function Spinner({ className, label }: { className?: string; label?: string }) {
  const ring = cn(
    "inline-block size-4 animate-spin rounded-full border-2 border-hairline-strong border-t-ink-muted",
    className,
  )
  return label ? <output aria-label={label} className={ring} /> : <span aria-hidden="true" className={ring} />
}

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-hairline bg-surface-2 px-1 font-mono text-caption text-ink-subtle",
        className,
      )}
      {...props}
    />
  )
}
