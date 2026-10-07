// "Let me try": in try mode, answers, formulas and reasons are blurred until the learner reveals
// them. The hidden content is `inert`, so it cannot be focused or read out before it is revealed.

import type { ReactNode } from "react"
import { useLesson, useMode } from "./context.tsx"

export function Reveal(props: {
  /** Unique within the lesson, e.g. `chain.s2.formula`. */
  readonly id: string
  readonly label?: string
  readonly children: ReactNode
  readonly className?: string
}) {
  const { mode, revealed, reveal } = useMode()
  const { t } = useLesson()
  const hidden = mode === "try" && !revealed.has(props.id)
  const cls = ["lsn-reveal", hidden ? "is-hidden" : "", props.className ?? ""].filter(Boolean).join(" ")
  return (
    <div className={cls} data-reveal={props.id}>
      <div className="lsn-reveal-body" inert={hidden}>
        {props.children}
      </div>
      {hidden && (
        <button type="button" className="lsn-reveal-btn" onClick={() => reveal([props.id])}>
          {props.label ?? t("reveal.button")}
        </button>
      )}
    </div>
  )
}

/** "Reveal next" / "Reveal all" for a section whose reveal ids are known in order. */
export function RevealControls(props: { readonly ids: ReadonlyArray<string> }) {
  const { mode, revealed, reveal } = useMode()
  const { t } = useLesson()
  if (mode !== "try") return null
  const left = props.ids.filter((id) => !revealed.has(id))
  if (left.length === 0) return null
  const next = left[0]
  return (
    <div className="lsn-reveal-controls">
      <button type="button" className="lsn-btn" onClick={() => next !== undefined && reveal([next])}>
        {t("reveal.next")}
      </button>
      <button type="button" className="lsn-btn lsn-btn-ghost" onClick={() => reveal(left)}>
        {t("reveal.all")}
      </button>
    </div>
  )
}
