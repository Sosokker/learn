import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip"
import type { ReactElement, ReactNode } from "react"

// Wrap the app once so moving between tooltips skips the open delay.
export function TooltipProvider(props: { readonly children: ReactNode }) {
  return <BaseTooltip.Provider delay={400}>{props.children}</BaseTooltip.Provider>
}

// A short hint on hover or keyboard focus. Not for essential information: touch users and many
// screen readers miss tooltips, so an icon-only button still needs its own aria-label.
export function Tooltip(props: {
  readonly content: ReactNode
  readonly children: ReactElement
  readonly side?: "top" | "bottom" | "left" | "right"
}) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={props.children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={props.side ?? "top"} sideOffset={6} className="z-50">
          <BaseTooltip.Popup className="max-w-64 rounded-md border border-hairline-strong bg-surface-3 px-2 py-1 text-caption text-ink-muted transition-opacity duration-100 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
            {props.content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
}
