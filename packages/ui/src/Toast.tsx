import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react"
import { AlertIcon, CheckIcon } from "./icons.tsx"

export type ToastTone = "neutral" | "success" | "danger"

interface ToastItem {
  readonly id: number
  readonly message: ReactNode
  readonly tone: ToastTone
}

type ShowToast = (message: ReactNode, tone?: ToastTone) => void

const ToastContext = createContext<ShowToast | null>(null)

// Short confirmations ("Link copied"). Errors that need reading stay inline next to the form.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ReadonlyArray<ToastItem>>([])
  const nextId = useRef(1)
  const show = useCallback<ShowToast>((message, tone = "neutral") => {
    const id = nextId.current++
    setItems((all) => [...all.slice(-2), { id, message, tone }])
    setTimeout(() => setItems((all) => all.filter((t) => t.id !== id)), 3500)
  }, [])
  const value = useMemo(() => show, [show])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2 max-md:right-1/2 max-md:translate-x-1/2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex items-center gap-2 rounded-md border border-hairline-strong bg-surface-3 px-3 py-2 text-dense text-ink"
          >
            {t.tone === "success" ? (
              <CheckIcon className="text-success" />
            ) : t.tone === "danger" ? (
              <AlertIcon className="text-danger" />
            ) : null}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ShowToast {
  const show = useContext(ToastContext)
  if (!show) throw new Error("useToast needs a <ToastProvider>")
  return show
}
