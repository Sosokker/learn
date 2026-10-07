import { useRender } from "@base-ui/react/use-render"
import type { ReactElement, ReactNode } from "react"
import { cx } from "./cx.ts"

// One row of the left sidebar (Library, Explore, a category). Renders an <a> by default; pass the
// router's link as `render` (e.g. render={<Link to="/library" />}). `active` marks the current
// page with aria-current and the selected style.
export function SidebarNavItem(props: {
  readonly label: ReactNode
  readonly icon?: ReactNode
  readonly count?: number
  readonly active?: boolean
  readonly href?: string
  readonly render?: ReactElement
}) {
  const active = props.active === true
  return useRender({
    defaultTagName: "a",
    render: props.render,
    props: {
      href: props.href,
      "aria-current": active ? "page" : undefined,
      className: cx(
        "flex h-7 items-center gap-2 rounded-md px-2 text-dense font-medium no-underline transition-colors",
        active ? "bg-surface-4 text-ink" : "text-ink-subtle hover:bg-surface-3 hover:text-ink",
      ),
      children: (
        <>
          {props.icon === undefined ? null : (
            <span
              aria-hidden
              className={cx("flex size-4 items-center justify-center", active && "text-accent")}
            >
              {props.icon}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">{props.label}</span>
          {props.count === undefined ? null : (
            <span className="text-caption text-ink-tertiary tabular-nums">{props.count}</span>
          )}
        </>
      ),
    },
  })
}
