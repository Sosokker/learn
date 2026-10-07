import { Menu as BaseMenu } from "@base-ui/react/menu"
import type { ReactElement, ReactNode } from "react"
import { cx } from "./cx.ts"
import { itemClass, popupClass } from "./popup.ts"

// A dropdown of actions (account menu, row actions). `trigger` is the element that opens it,
// usually a <Button />; Base UI wires its aria attributes and keyboard handling.
export function Menu(props: {
  readonly trigger: ReactElement
  readonly children: ReactNode
  readonly side?: "top" | "bottom" | "left" | "right"
  readonly align?: "start" | "center" | "end"
}) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={props.trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner
          side={props.side ?? "bottom"}
          align={props.align ?? "start"}
          sideOffset={4}
          className="z-50 outline-none"
        >
          <BaseMenu.Popup className={popupClass}>{props.children}</BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  )
}

export function MenuItem(props: {
  readonly children: ReactNode
  readonly onClick?: () => void
  readonly icon?: ReactNode
  readonly shortcut?: ReactNode
  readonly disabled?: boolean
  readonly danger?: boolean
}) {
  return (
    <BaseMenu.Item
      disabled={props.disabled ?? false}
      onClick={() => props.onClick?.()}
      className={cx(itemClass, props.danger === true && "text-danger data-[highlighted]:text-danger")}
    >
      {props.icon === undefined ? null : <span className="text-ink-subtle">{props.icon}</span>}
      <span className="flex-1 truncate">{props.children}</span>
      {props.shortcut === undefined ? null : (
        <span className="text-caption text-ink-tertiary">{props.shortcut}</span>
      )}
    </BaseMenu.Item>
  )
}

// A link inside a menu (keeps menu keyboard handling). Pass a router Link via `render`.
export function MenuLinkItem(props: { readonly render: ReactElement; readonly children: ReactNode }) {
  return (
    <BaseMenu.LinkItem render={props.render} className={itemClass}>
      {props.children}
    </BaseMenu.LinkItem>
  )
}

export function MenuSeparator() {
  return <BaseMenu.Separator className="mx-1 my-1 h-px bg-hairline" />
}

export function MenuGroupLabel(props: { readonly children: ReactNode }) {
  return (
    <BaseMenu.Group>
      <BaseMenu.GroupLabel className="px-2 py-1 text-caption font-medium text-ink-tertiary">
        {props.children}
      </BaseMenu.GroupLabel>
    </BaseMenu.Group>
  )
}
