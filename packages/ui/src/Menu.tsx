import { Menu as BaseMenu } from "@base-ui/react/menu"
import type { ReactElement, ReactNode } from "react"
import { cn } from "./cn.ts"

export type MenuEntry =
  | {
      readonly kind?: "item"
      readonly label: ReactNode
      readonly icon?: ReactNode
      readonly onSelect: () => void
      readonly danger?: boolean
      readonly disabled?: boolean
    }
  | { readonly kind: "separator" }
  | { readonly kind: "label"; readonly label: ReactNode }

export interface MenuProps {
  // A <button> element (e.g. <IconButton/>); the menu wires its aria attributes.
  trigger: ReactElement
  entries: ReadonlyArray<MenuEntry>
  align?: "start" | "end"
  side?: "top" | "bottom"
}

export function Menu({ trigger, entries, align = "end", side = "bottom" }: MenuProps) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner className="z-50 outline-none" sideOffset={6} align={align} side={side}>
          <BaseMenu.Popup
            className={cn(
              "min-w-44 origin-(--transform-origin) rounded-md border border-hairline-strong bg-surface-3 p-1 text-dense text-ink outline-none",
              "transition-[opacity,scale] duration-100 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0",
            )}
          >
            {entries.map((entry, i) => {
              if (entry.kind === "separator") {
                // biome-ignore lint/suspicious/noArrayIndexKey: entries are static per render
                return <BaseMenu.Separator key={i} className="mx-1 my-1 h-px bg-hairline" />
              }
              if (entry.kind === "label") {
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: entries are static per render
                  <div key={i} className="px-2 pt-1.5 pb-1 text-caption text-ink-subtle">
                    {entry.label}
                  </div>
                )
              }
              return (
                <BaseMenu.Item
                  // biome-ignore lint/suspicious/noArrayIndexKey: entries are static per render
                  key={i}
                  disabled={entry.disabled ?? false}
                  onClick={entry.onSelect}
                  className={cn(
                    "flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 outline-none select-none data-disabled:opacity-50 data-highlighted:bg-surface-4",
                    entry.danger ? "text-danger" : "text-ink-muted data-highlighted:text-ink",
                  )}
                >
                  {entry.icon ? (
                    <span className="inline-flex size-4 text-ink-subtle">{entry.icon}</span>
                  ) : null}
                  {entry.label}
                </BaseMenu.Item>
              )
            })}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  )
}
