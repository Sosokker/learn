import type { ReactNode } from "react"
import { useLesson } from "./context.ts"
import { useStore } from "./store.ts"

// In "let me try" mode an answer stays hidden until clicked. Reveals are remembered per element id,
// so switching modes back and forth keeps what the reader already opened.
export function useHidden(id: string): readonly [boolean, () => void] {
  const { tryMode, reveals } = useLesson()
  const on = useStore(tryMode, (v) => v)
  const shown = useStore(reveals, (r) => r.has(id))
  const reveal = () => reveals.set((r) => new Set(r).add(id))
  return [on && !shown, reveal] as const
}

export function Reveal({ id, children }: { readonly id: string; readonly children: ReactNode }) {
  const { s, uiLang } = useLesson()
  const [hidden, reveal] = useHidden(id)
  if (!hidden) return children
  return (
    <div className="lx-reveal">
      <div className="lx-reveal-body" inert aria-hidden="true">
        {children}
      </div>
      <button type="button" className="lx-reveal-btn" onClick={reveal} lang={uiLang}>
        {s.reveal}
      </button>
    </div>
  )
}
