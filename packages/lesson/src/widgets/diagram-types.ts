import type { ReactNode } from "react"

export interface DiagramNode {
  readonly id: string
  /** What the node shows (Rich rendered by the caller). */
  readonly label: ReactNode
  /** Plain text of the label: used for layout size and the accessible name. */
  readonly text: string
  /** `data-target` key (see model.ts `targetKey`). */
  readonly target: string
  /** Part id: colors the node and joins the linked highlight. */
  readonly part?: string | undefined
  /** CSS color for a node without a part. */
  readonly color?: string | undefined
  readonly variant?: "goal" | "dashed" | "plain" | undefined
}

export interface DiagramEdge {
  /** Also React Flow's `data-id` on the edge element (the highlight CSS targets it). */
  readonly id: string
  readonly from: string
  readonly to: string
  readonly label?: string | undefined
  readonly color?: string | undefined
  readonly animated?: boolean | undefined
}

export interface DiagramProps {
  readonly nodes: ReadonlyArray<DiagramNode>
  readonly edges: ReadonlyArray<DiagramEdge>
  readonly direction: "BT" | "LR"
  readonly ariaLabel: string
}
