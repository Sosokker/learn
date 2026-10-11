// The inspector: shows the hovered (or pinned) part, card, step, line or node. When pinned, the
// stack of drilled-into cards shows as a "where this sits" tree and links inside the card open
// the next level (the lesson root handles those clicks).

import type { Card, ConceptSpec, Part } from "@app/domain"
import type { ReactNode } from "react"
import { RoleBadge } from "./chrome.tsx"
import { useLesson } from "./context.tsx"
import { childrenOf, type ItemEntry, type Target, targetKey } from "./model.ts"
import { buildRef, hasRef, refName } from "./refs.ts"
import { Reveal } from "./reveal.tsx"
import { RichBlocks, RichInline, TargetTitle, Tex } from "./rich.tsx"

function Labeled(props: { readonly label: string; readonly src: string | undefined }) {
  if (props.src === undefined) return null
  return (
    <div className="lsn-field">
      <span className="lsn-label">{props.label}</span>
      <RichBlocks src={props.src} />
    </div>
  )
}

function Extras(props: { readonly example?: string | undefined; readonly analogy?: string | undefined }) {
  const { t } = useLesson()
  return (
    <>
      {props.example !== undefined && (
        <div className="lsn-ex">
          <span className="lsn-label">{t("field.example")}</span>
          <RichBlocks src={props.example} />
        </div>
      )}
      {props.analogy !== undefined && (
        <div className="lsn-an">
          <span className="lsn-label">{t("field.analogy")}</span>
          <RichBlocks src={props.analogy} />
        </div>
      )}
    </>
  )
}

interface View {
  readonly kicker: ReactNode
  readonly title: ReactNode
  readonly body: ReactNode
}

function partView(id: string, p: Part, kicker?: ReactNode): View {
  return {
    kicker: kicker ?? <RoleBadge role={p.role} part={id} />,
    title: (
      <>
        <button type="button" className="lsn-part lsn-dot-label" data-p={id} data-target={`part:${id}`}>
          <span aria-hidden>● </span>
          <RichInline src={p.label} plain />
        </button>{" "}
        <span className="lsn-muted lsn-meaning">{p.meaning}</span>
      </>
    ),
    body: (
      <>
        {p.body !== undefined && <RichBlocks src={p.body} />}
        <Extras example={p.example} analogy={p.analogy} />
      </>
    ),
  }
}

function CardBody(props: { readonly card: Card }) {
  const { t } = useLesson()
  const c = props.card
  return (
    <>
      <RichBlocks src={c.body} />
      <Labeled label={t("field.says")} src={c.says} />
      <Labeled label={t("field.from")} src={c.from} />
      <Labeled label={t("field.useWhen")} src={c.useWhen} />
      <Labeled label={t("field.units")} src={c.units} />
      <Extras example={c.example} analogy={c.analogy} />
    </>
  )
}

function SharedBadge(props: { readonly slug: string }) {
  const { model, t } = useLesson()
  const uses = model.conceptUses(props.slug)
  return (
    <span className="lsn-shared">
      <span className="lsn-shared-badge">{t("inspector.shared")}</span>
      {uses !== undefined && <span className="lsn-muted">{t("inspector.usedBy", { count: uses })}</span>}
    </span>
  )
}

function cardView(
  card: Card | undefined,
  slug: string | undefined,
  concept: ConceptSpec | undefined,
  t: ReturnType<typeof useLesson>["t"],
  kickerSuffix?: string,
): View {
  if (card === undefined) {
    return {
      kicker: slug === undefined ? null : <SharedBadge slug={slug} />,
      title: <span>{slug}</span>,
      body: <p className="lsn-muted">{t("inspector.missingConcept", { slug: slug ?? "" })}</p>,
    }
  }
  const kicker = card.kicker ?? t(`card.kind.${card.kind}`)
  return {
    kicker: (
      <>
        <span>{kickerSuffix === undefined ? kicker : `${kicker} · ${kickerSuffix}`}</span>
        {(slug ?? concept?.slug) !== undefined && <SharedBadge slug={slug ?? concept?.slug ?? ""} />}
      </>
    ),
    title: <RichInline src={card.title} />,
    body: <CardBody card={card} />,
  }
}

function useItemView(it: ItemEntry): View {
  const { model, t } = useLesson()
  switch (it.type) {
    case "chain":
      return {
        kicker: t("inspector.stepParts"),
        title: (
          <>
            {it.index + 1}. <RichInline src={it.step.move} />
          </>
        ),
        body: (
          <>
            <Reveal id={`${it.sectionId}.${it.itemId}`}>
              {it.step.formula !== undefined && (
                <div className="lsn-fx">
                  <Tex tex={it.step.formula} display />
                </div>
              )}
              <Labeled label={t("field.why")} src={it.step.why} />
              <Labeled label={t("field.whyNot")} src={it.step.whyNot} />
            </Reveal>
            <ul className="lsn-part-list">
              {it.step.uses.map((u) => {
                const p = model.part(u)
                if (p === undefined) return null
                return (
                  <li key={u}>
                    <button type="button" className="lsn-part" data-p={u} data-target={`part:${u}`}>
                      <RichInline src={p.label} plain />
                    </button>{" "}
                    <span className="lsn-muted">{p.meaning}</span>
                  </li>
                )
              })}
            </ul>
          </>
        ),
      }
    case "proof": {
      const lines = it.section.lines
      const deps = it.line.deps.map((d) => lines.findIndex((l) => l.id === d) + 1).filter((n) => n > 0)
      return {
        kicker: t("inspector.lineOf", { n: it.index + 1, total: lines.length }),
        title: <RichInline src={it.line.claim} />,
        body: (
          <>
            <Reveal id={`${it.sectionId}.${it.itemId}`} label={t("reveal.why")}>
              <Labeled label={t("field.why")} src={it.line.why} />
              <Labeled label={t("field.intuition")} src={it.line.intuition} />
              <Labeled label={t("field.whyNot")} src={it.line.whyNot} />
            </Reveal>
            <p className="lsn-muted">
              {deps.length === 0
                ? t("inspector.usesNone")
                : t("inspector.usesLines", { lines: deps.join(", ") })}
            </p>
          </>
        ),
      }
    }
    case "graph": {
      const n = it.node
      const labels = n.needs.map((d) => it.section.nodes.find((x) => x.id === d)?.label ?? d)
      const depends = (
        <p className="lsn-muted">
          {labels.length === 0
            ? t("inspector.dependsNone")
            : t("inspector.dependsOn", { list: labels.join(", ") })}
        </p>
      )
      const kind = `${t(`graph.kind.${n.kind}`)} · ${t("inspector.inGraph")}`
      const r = n.card === undefined ? undefined : model.card(n.card)
      if (r !== undefined) {
        const v = cardView(r.card, r.conceptSlug, r.concept, t, t("inspector.inGraph"))
        return {
          ...v,
          body: (
            <>
              {v.body}
              {depends}
            </>
          ),
        }
      }
      const p = n.part === undefined ? undefined : model.part(n.part)
      if (p !== undefined && n.part !== undefined) {
        const v = partView(n.part, p, kind)
        return {
          ...v,
          body: (
            <>
              {v.body}
              {depends}
            </>
          ),
        }
      }
      return { kicker: kind, title: n.label, body: depends }
    }
    case "chunks":
      return {
        kicker: <RoleBadge role={it.row.role} />,
        title: <RichInline src={it.row.text} />,
        body: <RichBlocks src={it.row.note} />,
      }
    case "plan":
      return {
        kicker: it.route.picked ? t("plan.picked") : t("plan.notPicked"),
        title: <RichInline src={it.route.title} />,
        body: (
          <>
            <RichBlocks src={it.route.path} />
            <Reveal id={`${it.sectionId}.${it.itemId}`} label={t("reveal.why")}>
              <Labeled label={t("field.why")} src={it.route.why} />
              <Labeled label={t("field.whyNot")} src={it.route.whyNot} />
            </Reveal>
          </>
        ),
      }
    case "story":
      return { kicker: it.event.year ?? "", title: null, body: <RichBlocks src={it.event.text} /> }
    case "units":
      return {
        kicker: `${it.index + 1}`,
        title: <RichInline src={it.unit.title} />,
        body: <RichBlocks src={it.unit.milestone} />,
      }
    case "recall":
      // No answer here: the inspector must not give the quiz away.
      return {
        kicker: `${it.index + 1}`,
        title: <RichInline src={it.question.q} />,
        body: (
          <ul className="lsn-option-list">
            {it.question.options.map((o, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: options are positional
              <li key={i}>
                <RichInline src={o} />
              </li>
            ))}
          </ul>
        ),
      }
    case "flow": {
      const n = it.node
      const r = n.card === undefined ? undefined : model.card(n.card)
      if (r !== undefined) return cardView(r.card, r.conceptSlug, r.concept, t)
      const p = n.part === undefined ? undefined : model.part(n.part)
      if (p !== undefined && n.part !== undefined) return partView(n.part, p)
      return { kicker: "", title: <RichInline src={n.label} />, body: null }
    }
  }
}

function ItemContent(props: { readonly it: ItemEntry }) {
  const v = useItemView(props.it)
  return <ViewBlock view={v} />
}

function ViewBlock(props: { readonly view: View }) {
  return (
    <>
      <div className="lsn-card-kicker">{props.view.kicker}</div>
      {props.view.title !== null && <div className="lsn-card-title">{props.view.title}</div>}
      <div className="lsn-card-body">{props.view.body}</div>
    </>
  )
}

function TargetContent(props: { readonly target: Target }) {
  const { model, t } = useLesson()
  const tg = props.target
  switch (tg.kind) {
    case "part": {
      const p = model.part(tg.id)
      return p === undefined ? null : <ViewBlock view={partView(tg.id, p)} />
    }
    case "card": {
      const r = model.card(tg.id)
      return r === undefined ? null : <ViewBlock view={cardView(r.card, r.conceptSlug, r.concept, t)} />
    }
    case "concept": {
      const c = model.concept(tg.slug)
      return <ViewBlock view={cardView(c?.card, tg.slug, c, t)} />
    }
    case "item": {
      const it = model.item(tg.section, tg.item)
      return it === undefined ? null : <ItemContent it={it} />
    }
    case "section": {
      const s = model.sections.get(tg.section)
      return s === undefined ? null : (
        <ViewBlock view={{ kicker: s.type, title: s.title ?? s.id, body: null }} />
      )
    }
  }
}

function Tree(props: {
  readonly stack: ReadonlyArray<Target>
  readonly onNavigate: (stack: ReadonlyArray<Target>) => void
}) {
  const { model, t } = useLesson()
  const { stack } = props
  const rows: Array<ReactNode> = []
  const row = (depth: number, target: Target, kind: "path" | "cur" | "kid", next: ReadonlyArray<Target>) => {
    const label = <TargetTitle target={target} />
    rows.push(
      <li key={`${rows.length}-${targetKey(target)}`} style={{ paddingInlineStart: depth * 14 }}>
        {kind === "cur" ? (
          <span className="lsn-tree-row is-cur" aria-current="true">
            ▾ {label}
          </span>
        ) : (
          <button
            type="button"
            className={`lsn-tree-row ${kind === "path" ? "is-path" : ""}`}
            data-no-pin=""
            onClick={() => props.onNavigate(next)}
          >
            {kind === "path" ? "▾" : "◦"} {label}
          </button>
        )}
      </li>,
    )
  }
  const level = (i: number, depth: number): void => {
    const s = stack[i]
    if (s === undefined || depth > 12) return
    const last = i === stack.length - 1
    const next = stack[i + 1]
    const kids = childrenOf(model, s)
    row(depth, s, last ? "cur" : "path", stack.slice(0, i + 1))
    let nextShown = false
    for (const k of kids) {
      if (next !== undefined && targetKey(k) === targetKey(next)) {
        nextShown = true
        level(i + 1, depth + 1)
      } else {
        row(depth + 1, k, "kid", [...stack.slice(0, i + 1), k])
      }
    }
    if (next !== undefined && !nextShown) level(i + 1, depth + 1)
  }
  level(0, 0)
  if (rows.length < 2) return null
  return (
    <nav className="lsn-tree" aria-label={t("inspector.where")}>
      <div className="lsn-label">{t("inspector.where")}</div>
      <ul>{rows}</ul>
    </nav>
  )
}

export interface InspectorProps {
  readonly target: Target | undefined
  readonly pinned: boolean
  readonly stack: ReadonlyArray<Target>
  readonly onNavigate: (stack: ReadonlyArray<Target>) => void
  readonly onClose: () => void
}

export function Inspector(props: InspectorProps) {
  const { model, t, actions } = useLesson()
  const { target, pinned } = props
  return (
    <div className="lsn-inspector-inner">
      <div className="lsn-inspector-head">
        <h2 className="lsn-inspector-title">
          {t("inspector.title")}
          {pinned && <span className="lsn-muted"> · {t("inspector.pinned")}</span>}
        </h2>
        {pinned && (
          <div className="lsn-inspector-tools">
            {props.stack.length > 1 && (
              <button
                type="button"
                className="lsn-btn lsn-btn-ghost"
                onClick={() => props.onNavigate(props.stack.slice(0, -1))}
              >
                ◀ {t("inspector.back")}
              </button>
            )}
            {target !== undefined && (
              <button type="button" className="lsn-btn lsn-btn-ghost" onClick={() => actions.addRef(target)}>
                {t("inspector.addRef")}
              </button>
            )}
            {target !== undefined && target.kind !== "concept" && actions.discuss !== undefined && (
              <button
                type="button"
                className="lsn-btn lsn-btn-ghost"
                onClick={() => actions.discuss?.(target)}
              >
                {t("inspector.discuss")}
              </button>
            )}
            {target !== undefined && hasRef(target) && (
              <button
                type="button"
                className="lsn-btn lsn-btn-ghost"
                onClick={() => {
                  const ref =
                    target.kind === "item"
                      ? buildRef(model.slug, target.section, target.item)
                      : refName(model, target)
                  actions.copy(ref, t("ref.copied", { text: ref }))
                }}
              >
                {t("inspector.copyRef")}
              </button>
            )}
            <button
              type="button"
              className="lsn-btn lsn-btn-ghost lsn-icon-btn"
              aria-label={t("inspector.close")}
              onClick={props.onClose}
            >
              ✕
            </button>
          </div>
        )}
      </div>
      {pinned && <Tree stack={props.stack} onNavigate={props.onNavigate} />}
      {target === undefined ? (
        <p className="lsn-muted">{t("inspector.empty")}</p>
      ) : (
        <div className="lsn-card" key={targetKey(target)}>
          <TargetContent target={target} />
          <p className="lsn-hint">{pinned ? t("inspector.hintPinned") : t("inspector.hintHover")}</p>
        </div>
      )}
    </div>
  )
}

/** The legend of parts: every part with its color, role and meaning. */
export function PartsLegend() {
  const { model, t } = useLesson()
  const parts = Object.entries(model.spec.parts)
  if (parts.length === 0) return null
  return (
    <div className="lsn-legend">
      <h2 className="lsn-inspector-title">{t("inspector.parts")}</h2>
      <ul>
        {parts.map(([id, p]) => (
          <li key={id}>
            <button type="button" className="lsn-part lsn-dot-label" data-p={id} data-target={`part:${id}`}>
              <span aria-hidden>● </span>
              <RichInline src={p.label} plain />
            </button>
            <span className="lsn-muted">
              {t(`role.${p.role}`)} · {p.meaning}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
