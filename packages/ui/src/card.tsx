import type { ComponentProps } from "react"
import { cx } from "./cx.ts"

export type SurfaceLevel = 1 | 2 | 3 | 4

const levels: Record<SurfaceLevel, string> = {
  1: "bg-surface-1",
  2: "bg-surface-2",
  3: "bg-surface-3",
  4: "bg-surface-4",
}

// A raised panel. Depth is the surface step plus a 1px hairline, never a shadow.
export function Surface(props: ComponentProps<"div"> & { readonly level?: SurfaceLevel }) {
  const { level, className, ...rest } = props
  return <div {...rest} className={cx("rounded-lg border border-hairline", levels[level ?? 1], className)} />
}

// A content card (12px radius, 24px padding). `interactive` adds the hover step for cards that
// contain a stretched link.
export function Card(props: ComponentProps<"div"> & { readonly interactive?: boolean }) {
  const { interactive, className, ...rest } = props
  return (
    <div
      {...rest}
      className={cx(
        "relative flex flex-col gap-3 rounded-lg border border-hairline bg-surface-1 p-6",
        interactive === true && "transition-colors hover:border-hairline-strong hover:bg-surface-2",
        className,
      )}
    />
  )
}
