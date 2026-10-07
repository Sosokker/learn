import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import type { ReactNode } from "react"
import { cn } from "./cn.ts"
import { CloseIcon } from "./icons.tsx"

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  // Buttons, right-aligned under a hairline.
  footer?: ReactNode
  closeLabel: string
  size?: "md" | "lg"
}

const backdrop =
  "fixed inset-0 z-40 bg-black/60 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0"

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  closeLabel,
  size = "md",
}: DialogProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={backdrop} />
        <BaseDialog.Popup
          className={cn(
            "fixed top-[10vh] left-1/2 z-50 flex max-h-[80vh] w-[calc(100vw-32px)] -translate-x-1/2 flex-col rounded-lg border border-hairline-strong bg-surface-2 text-ink",
            "transition-[opacity,scale] duration-150 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0",
            size === "lg" ? "max-w-2xl" : "max-w-lg",
          )}
        >
          <div className="flex items-start gap-3 border-b border-hairline px-5 py-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <BaseDialog.Title className="text-body font-semibold">{title}</BaseDialog.Title>
              {description ? (
                <BaseDialog.Description className="text-dense text-ink-subtle">
                  {description}
                </BaseDialog.Description>
              ) : null}
            </div>
            <BaseDialog.Close
              aria-label={closeLabel}
              className="-mt-1 -mr-2 inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-ink-subtle hover:bg-surface-3 hover:text-ink"
            >
              <CloseIcon />
            </BaseDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-hairline px-5 py-3">
              {footer}
            </div>
          ) : null}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

export interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Screen-reader name of the panel.
  title: string
  children: ReactNode
}

// A panel that slides in from the left: the sidebar on phones.
export function Sheet({ open, onOpenChange, title, children }: SheetProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={backdrop} />
        <BaseDialog.Popup
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-hairline bg-surface-1 text-ink",
            "transition-transform duration-200 ease-out data-ending-style:-translate-x-full data-starting-style:-translate-x-full",
          )}
        >
          <BaseDialog.Title className="sr-only">{title}</BaseDialog.Title>
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
