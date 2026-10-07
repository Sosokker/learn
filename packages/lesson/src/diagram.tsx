// React Flow + dagre, loaded lazily so the lesson's main chunk stays small.
import "@xyflow/react/dist/style.css"
import type { FlowWidget, GraphSection } from "@app/domain"
import dagre from "@dagrejs/dagre"
import { type Edge, Handle, MarkerType, type Node, type NodeProps, Position, ReactFlow } from "@xyflow/react"
import { createContext, useContext, useMemo, useState } from "react"
import type { Target } from "./cards.ts"
import { Rich } from "./rich.tsx"

interface Laid {
  readonly pos: Map<string, { x: number; y: number }>
  readonly width: number
  readonly height: number
}

function layout(
  nodes: ReadonlyArray<{ id: string; w: number; h: number }>,
  edges: ReadonlyArray<{ from: string; to: string }>,
  rankdir: "TB" | "LR",
): Laid {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir, nodesep: 28, ranksep: 56, marginx: 8, marginy: 8 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of nodes) g.setNode(n.id, { width: n.w, height: n.h })
  const ids = new Set(nodes.map((n) => n.id))
  for (const e of edges) if (ids.has(e.from) && ids.has(e.to)) g.setEdge(e.from, e.to)
  dagre.layout(g)
  const pos = new Map<string, { x: number; y: number }>()
  for (const n of nodes) {
    const p = g.node(n.id)
    // dagre gives centers; React Flow wants top-left corners.
    pos.set(n.id, { x: (p?.x ?? 0) - n.w / 2, y: (p?.y ?? 0) - n.h / 2 })
  }
  const gl = g.graph()
  return { pos, width: gl.width ?? 400, height: gl.height ?? 200 }
}

// Arrowheads: React Flow draws markers with a fixed color, so these match the hairline tokens.
const arrow = { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#62666d" } as const
const arrowLit = { ...arrow, color: "#828fff" } as const

// Rough label width so dagre leaves room; the node itself still wraps if a guess is short.
const labelWidth = (s: string) => Math.min(220, Math.max(96, s.length * 7.4 + 32))

type GraphNodeData = {
  readonly id: string
  readonly label: string
  readonly kindLabel: string
  readonly part: string | undefined
  readonly card: string | undefined
  readonly lit: string
  readonly refKey: string
}

// Hover state reaches the nodes through context, so the `nodes` array stays the same object and
// React Flow doesn't re-measure (and briefly hide) every node on each hover.
const GraphHot = createContext<{ hot: string | null; deps: ReadonlySet<string> | null }>({
  hot: null,
  deps: null,
})

function GraphNodeView({ data }: NodeProps<Node<GraphNodeData>>) {
  const { hot, deps } = useContext(GraphHot)
  const state = deps === null ? "" : data.id === hot ? "is-src" : deps.has(data.id) ? "is-dep" : "is-dim"
  return (
    <div
      className={`lx-gnode ${state} ${data.card === undefined ? "" : "has-card"}`}
      data-part={data.part}
      data-lit={data.lit}
      data-ref={data.refKey}
    >
      <Handle type="target" position={Position.Top} className="lx-handle" />
      <span className="lx-gnode-kind">{data.kindLabel}</span>
      <span className="lx-gnode-label">{data.label}</span>
      <Handle type="source" position={Position.Bottom} className="lx-handle" />
    </div>
  )
}

const graphTypes = { lx: GraphNodeView }

const flowProps = {
  nodesDraggable: false,
  nodesConnectable: false,
  elementsSelectable: false,
  zoomOnScroll: false,
  zoomOnPinch: true,
  panOnScroll: false,
  panOnDrag: false,
  preventScrolling: false,
  zoomOnDoubleClick: false,
  fitView: true,
  fitViewOptions: { padding: 0.08, maxZoom: 1 },
  minZoom: 0.3,
} as const

// Edges point from what is needed to what uses it. Hovering a node lights it and everything it
// depends on, transitively, and their parts across the lesson (through `data-lit`).
export function GraphCanvas({
  section,
  kindLabels,
  onOpen,
}: {
  readonly section: typeof GraphSection.Type
  readonly kindLabels: Readonly<Record<string, string>>
  readonly onOpen: (t: Target) => void
}) {
  const [hot, setHot] = useState<string | null>(null)
  const byId = useMemo(() => new Map(section.nodes.map((n) => [n.id, n])), [section.nodes])
  const closure = useMemo(() => {
    const out = new Map<string, Set<string>>()
    const visit = (id: string): Set<string> => {
      const hit = out.get(id)
      if (hit) return hit
      const set = new Set<string>([id])
      out.set(id, set)
      for (const need of byId.get(id)?.needs ?? []) for (const d of visit(need)) set.add(d)
      return set
    }
    for (const n of section.nodes) visit(n.id)
    return out
  }, [section.nodes, byId])
  const laid = useMemo(
    () =>
      layout(
        section.nodes.map((n) => ({ id: n.id, w: labelWidth(n.label), h: 50 })),
        section.nodes.flatMap((n) => n.needs.map((need) => ({ from: need, to: n.id }))),
        "TB",
      ),
    [section.nodes],
  )
  const deps = hot === null ? null : (closure.get(hot) ?? null)
  const nodes = useMemo(
    (): Array<Node<GraphNodeData>> =>
      section.nodes.map((n) => {
        const lit = [...(closure.get(n.id) ?? [n.id])].flatMap((id) => {
          const p = byId.get(id)?.part
          return p === undefined ? [] : [p]
        })
        return {
          id: n.id,
          type: "lx",
          position: laid.pos.get(n.id) ?? { x: 0, y: 0 },
          width: labelWidth(n.label),
          data: {
            id: n.id,
            label: n.label,
            kindLabel: kindLabels[n.kind] ?? n.kind,
            part: n.part,
            card: n.card,
            lit: lit.join(" "),
            refKey: `${section.id}.${n.id}`,
          },
        }
      }),
    [section, closure, byId, laid, kindLabels],
  )
  const hotValue = useMemo(() => ({ hot, deps }), [hot, deps])
  const edges: Array<Edge> = section.nodes.flatMap((n) =>
    n.needs
      .filter((need) => byId.has(need))
      .map((need) => ({
        id: `${need}->${n.id}`,
        source: need,
        target: n.id,
        className: deps === null ? "" : deps.has(n.id) && deps.has(need) ? "is-dep" : "is-dim",
        markerEnd: deps?.has(n.id) && deps.has(need) ? arrowLit : arrow,
      })),
  )
  return (
    <GraphHot.Provider value={hotValue}>
      <div className="lx-diagram" style={{ height: Math.min(520, Math.max(200, laid.height + 32)) }}>
        <ReactFlow
          {...flowProps}
          nodes={nodes}
          edges={edges}
          nodeTypes={graphTypes}
          onNodeMouseEnter={(_, n) => setHot(n.id)}
          onNodeMouseLeave={() => setHot(null)}
          onNodeClick={(e, n) => {
            const card = byId.get(n.id)?.card
            if (card !== undefined && !e.altKey) onOpen({ k: "card", id: card })
            else {
              const part = byId.get(n.id)?.part
              if (part !== undefined && !e.altKey) onOpen({ k: "part", id: part })
            }
          }}
        />
      </div>
    </GraphHot.Provider>
  )
}

type FlowNodeData = {
  readonly label: string
  readonly part: string | undefined
  readonly card: string | undefined
  readonly refKey: string
}

function FlowNodeView({ data }: NodeProps<Node<FlowNodeData>>) {
  return (
    <div
      className={`lx-fnode ${data.card === undefined ? "" : "has-card"}`}
      data-part={data.part}
      data-ref={data.refKey}
    >
      <Handle type="target" position={Position.Left} className="lx-handle" />
      <Rich src={data.label} inline />
      <Handle type="source" position={Position.Right} className="lx-handle" />
    </div>
  )
}

const flowTypes = { lx: FlowNodeView }

export function FlowCanvas({
  widget,
  sectionId,
  onOpen,
  plain,
}: {
  readonly widget: typeof FlowWidget.Type
  readonly sectionId: string
  readonly onOpen: (t: Target) => void
  readonly plain: (rich: string) => string
}) {
  const laid = useMemo(
    () =>
      layout(
        widget.nodes.map((n) => ({ id: n.id, w: labelWidth(plain(n.label)), h: 44 })),
        widget.edges,
        "LR",
      ),
    [widget, plain],
  )
  const nodes = useMemo(
    (): Array<Node<FlowNodeData>> =>
      widget.nodes.map((n) => ({
        id: n.id,
        type: "lx",
        position: laid.pos.get(n.id) ?? { x: 0, y: 0 },
        width: labelWidth(plain(n.label)),
        data: { label: n.label, part: n.part, card: n.card, refKey: `${sectionId}.${n.id}` },
      })),
    [widget, laid, plain, sectionId],
  )
  const edges = useMemo(
    (): Array<Edge> =>
      widget.edges.map((e, i) => ({
        id: `${e.from}->${e.to}#${i}`,
        source: e.from,
        target: e.to,
        animated: true,
        markerEnd: arrow,
        className: e.part === undefined ? "" : `lx-edge-part-${e.part}`,
        ...(e.label === undefined ? {} : { label: plain(e.label) }),
      })),
    [widget, plain],
  )
  return (
    <div className="lx-diagram" style={{ height: Math.min(480, Math.max(160, laid.height + 32)) }}>
      <ReactFlow
        {...flowProps}
        nodes={nodes}
        edges={edges}
        nodeTypes={flowTypes}
        onNodeClick={(e, n) => {
          const node = widget.nodes.find((x) => x.id === n.id)
          if (node?.card !== undefined && !e.altKey) onOpen({ k: "card", id: node.card })
        }}
      />
    </div>
  )
}
