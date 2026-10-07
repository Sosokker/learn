// The concept graph section and the flow widget. Both draw with the lazy React Flow diagram.

import type { FlowWidget, GraphNodeKind, GraphSection, RoleColor } from "@app/domain"
import { roleColorVar } from "@app/ui"
import { lazy, Suspense } from "react"
import { SectionFrame } from "../chrome.tsx"
import { useLesson } from "../context.tsx"
import { richText } from "../model.ts"
import { RichInline } from "../rich.tsx"
import type { DiagramEdge, DiagramNode } from "./diagram-types.ts"

const Diagram = lazy(() => import("./diagram.tsx"))

/** React Flow edge id for a graph edge; the highlight CSS lights edges by this id. */
export const graphEdgeId = (section: string, from: string, to: string): string => `${section}__${from}__${to}`

const kindColor: Record<GraphNodeKind, RoleColor | undefined> = {
  goal: "blue",
  lemma: "yellow",
  thm: "green",
  law: "green",
  def: "grey",
  step: "grey",
  part: undefined,
}

function DiagramFallback(props: { readonly height: number }) {
  const { t } = useLesson()
  return (
    <div className="lsn-diagram lsn-diagram-loading" style={{ height: props.height }}>
      {t("graph.loading")}
    </div>
  )
}

export function GraphView(props: { readonly section: GraphSection }) {
  const s = props.section
  const { model, t } = useLesson()
  const nodes: Array<DiagramNode> = s.nodes.map((n) => {
    const part = n.part !== undefined && model.part(n.part) !== undefined ? n.part : undefined
    const color = kindColor[n.kind]
    return {
      id: n.id,
      label: n.label,
      text: n.label,
      target: `item:${s.id}.${n.id}`,
      part,
      color: color === undefined ? undefined : roleColorVar(color),
      variant: n.kind === "goal" ? "goal" : n.kind === "def" ? "dashed" : "plain",
    }
  })
  const edges: Array<DiagramEdge> = s.nodes.flatMap((n) =>
    n.needs.map((d) => ({ id: graphEdgeId(s.id, d, n.id), from: d, to: n.id })),
  )
  const used = [...new Set(s.nodes.map((n) => n.kind))]
  return (
    <SectionFrame section={s}>
      <Suspense fallback={<DiagramFallback height={240} />}>
        <Diagram nodes={nodes} edges={edges} direction="BT" ariaLabel={s.title ?? s.id} />
      </Suspense>
      <ul className="lsn-legend-row">
        {used.map((k) => {
          const c = kindColor[k]
          return (
            <li key={k} style={c === undefined ? undefined : { color: roleColorVar(c) }}>
              <span className="lsn-legend-swatch" aria-hidden />
              <span>{t(`graph.kind.${k}`)}</span>
            </li>
          )
        })}
        <li className="lsn-muted">{t("graph.legend")}</li>
      </ul>
    </SectionFrame>
  )
}

export function FlowView(props: {
  readonly sectionId: string
  readonly widget: FlowWidget
  readonly label: string
}) {
  const { model } = useLesson()
  const w = props.widget
  const nodes: Array<DiagramNode> = w.nodes.map((n) => ({
    id: n.id,
    label: <RichInline src={n.label} plain />,
    text: richText(n.label),
    target: `item:${props.sectionId}.${n.id}`,
    part: n.part !== undefined && model.part(n.part) !== undefined ? n.part : undefined,
  }))
  const edges: Array<DiagramEdge> = w.edges.map((e, i) => {
    const part = e.part === undefined ? undefined : model.part(e.part)
    return {
      id: `${props.sectionId}__e${i}`,
      from: e.from,
      to: e.to,
      label: e.label === undefined ? undefined : richText(e.label),
      color: part === undefined ? undefined : roleColorVar(part.color),
      animated: true,
    }
  })
  return (
    <Suspense fallback={<DiagramFallback height={200} />}>
      <Diagram nodes={nodes} edges={edges} direction="LR" ariaLabel={props.label} />
    </Suspense>
  )
}
