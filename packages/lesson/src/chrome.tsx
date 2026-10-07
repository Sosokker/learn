// Small shared pieces: the section frame, the @ref chip, role badges.

import type { Role, Section } from "@app/domain"
import type { ReactNode } from "react"
import { useLesson } from "./context.tsx"
import { buildRef } from "./refs.ts"

/** A copyable `@ref` chip. Focusing it also shows its item in the inspector (via `data-target`). */
export function RefButton(props: { readonly section: string; readonly item?: string }) {
  const { model, t, actions } = useLesson()
  const ref = buildRef(model.slug, props.section, props.item)
  const short = props.item === undefined ? `@${props.section}` : `@${props.item}`
  return (
    <button
      type="button"
      className="lsn-ref"
      data-no-pin=""
      aria-label={t("ref.copy", { ref })}
      title={ref}
      onClick={(e) => {
        if (e.altKey) {
          actions.addRef(
            props.item === undefined
              ? { kind: "section", section: props.section }
              : { kind: "item", section: props.section, item: props.item },
          )
          return
        }
        actions.copy(ref, t("ref.copied", { text: ref }))
      }}
    >
      {short}
    </button>
  )
}

export function SectionFrame(props: {
  readonly section: Section
  readonly children: ReactNode
  readonly actions?: ReactNode
}) {
  const s = props.section
  const headingId = `lsn-h-${s.id}`
  return (
    <section
      className={`lsn-section lsn-section-${s.type}`}
      id={`section-${s.id}`}
      aria-labelledby={s.title === undefined ? undefined : headingId}
      data-ref={`section:${s.id}`}
    >
      <header className="lsn-section-head">
        {s.title !== undefined && (
          <h2 className="lsn-section-title" id={headingId}>
            {s.title}
          </h2>
        )}
        {s.note !== undefined && <span className="lsn-section-note">{s.note}</span>}
        <span className="lsn-section-tools">
          {props.actions}
          <RefButton section={s.id} />
        </span>
      </header>
      {props.children}
    </section>
  )
}

export function RoleBadge(props: { readonly role: Role; readonly part?: string | undefined }) {
  const { t } = useLesson()
  return (
    <span className="lsn-badge" data-role={props.role} data-p={props.part}>
      {t(`role.${props.role}`)}
    </span>
  )
}
