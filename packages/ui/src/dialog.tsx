import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import type { ReactNode } from "react"
import { CloseIcon } from "./icons.tsx"

// A modal dialog. Base UI traps focus, closes on Escape and returns focus to the opener.
// `footer` holds the actions (Cancel / Confirm buttons), right-aligned.
export function Dialog(props: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly title: string
  readonly description?: ReactNode
  readonly closeLabel: string
  readonly children?: ReactNode
  readonly footer?: ReactNode
}) {
  return (
    <BaseDialog.Root open={props.open} onOpenChange={(open) => props.onOpenChange(open)}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-40 bg-overlay/60 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <BaseDialog.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[30rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-auto rounded-lg border border-hairline-strong bg-surface-2 p-5 text-ink outline-none transition-[scale,opacity] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <BaseDialog.Title className="text-body font-semibold break-words">
                {props.title}
              </BaseDialog.Title>
              {props.description === undefined ? null : (
                <BaseDialog.Description className="text-body-sm text-ink-subtle">
                  {props.description}
                </BaseDialog.Description>
              )}
            </div>
            <BaseDialog.Close
              aria-label={props.closeLabel}
              className="-m-1 inline-flex size-7 items-center justify-center rounded-md text-ink-subtle hover:bg-surface-4 hover:text-ink"
            >
              <CloseIcon />
            </BaseDialog.Close>
          </div>
          {props.children}
          {props.footer === undefined ? null : <div className="flex justify-end gap-2">{props.footer}</div>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
