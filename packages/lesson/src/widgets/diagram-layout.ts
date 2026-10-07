// dagre layout for the concept graph and the flow widget. Only the lazy diagram chunk and tests
// import this, so dagre stays out of the main bundle.

import dagre from "@dagrejs/dagre"

export interface LayoutNode {
  readonly id: string
  readonly width: number
  readonly height: number
}

export interface LayoutEdge {
  readonly from: string
  readonly to: string
}

export interface Positioned {
  /** Top-left corner, as React Flow wants it. */
  readonly x: number
  readonly y: number
}

export interface Layout {
  readonly positions: ReadonlyMap<string, Positioned>
  readonly width: number
  readonly height: number
}

/**
 * Lay out a directed graph. `BT` puts sources (what is needed) at the bottom and arrows point up
 * to what uses them, like the prototype's concept graph; `LR` reads left to right (flows).
 */
export const layoutDiagram = (
  nodes: ReadonlyArray<LayoutNode>,
  edges: ReadonlyArray<LayoutEdge>,
  direction: "BT" | "LR",
): Layout => {
  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: direction,
    nodesep: 18,
    ranksep: direction === "BT" ? 46 : 60,
    marginx: 8,
    marginy: 8,
  })
  g.setDefaultEdgeLabel(() => ({}))
  const ids = new Set(nodes.map((n) => n.id))
  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height })
  for (const e of edges) if (ids.has(e.from) && ids.has(e.to) && e.from !== e.to) g.setEdge(e.from, e.to)
  dagre.layout(g)
  const positions = new Map<string, Positioned>()
  let width = 0
  let height = 0
  for (const n of nodes) {
    const p = g.node(n.id)
    const x = (p?.x ?? 0) - n.width / 2
    const y = (p?.y ?? 0) - n.height / 2
    positions.set(n.id, { x, y })
    width = Math.max(width, x + n.width)
    height = Math.max(height, y + n.height)
  }
  return { positions, width, height }
}

/** Rough label box for layout, before the DOM exists. Thai and Latin both fit at ~7.2px/char. */
export const labelSize = (text: string): { readonly width: number; readonly height: number } => {
  const lines = text.split("\n").map((l) => [...l].length)
  const longest = Math.max(...lines, 1)
  const perLine = Math.floor((240 - 28) / 7.2)
  const rows = lines.reduce((n, len) => n + Math.max(1, Math.ceil(len / perLine)), 0)
  return { width: Math.min(240, Math.max(64, longest * 7.2 + 28)), height: 20 * rows + 18 }
}
