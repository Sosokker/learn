import type { ReactNode } from "react"
import { cx } from "./cx.ts"

// A keyboard key, as in "⌘ K". One <Kbd> per key.
export function Kbd(props: { readonly children: ReactNode; readonly className?: string }) {
  return (
    <kbd
      className={cx(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-hairline-strong bg-surface-3 px-1 font-sans text-caption text-ink-subtle",
        props.className,
      )}
    >
      {props.children}
    </kbd>
  )
}
