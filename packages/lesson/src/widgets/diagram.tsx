// React Flow + dagre diagram, shared by the concept graph section and the flow widget.
// Loaded lazily (see lazy.tsx): React Flow and dagre are not in the main lesson bundle.
// Nodes are <button>s with `data-target`, so the lesson's hover / focus / click delegation and the
// linked highlight work on them like on any other part of the lesson.

import "@xyflow/react/dist/style.css"
import { useResolvedTheme } from "@app/ui"
import {
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react"
import { type CSSProperties, useMemo } from "react"
import { labelSize, layoutDiagram } from "./diagram-layout.ts"
import type { DiagramNode, DiagramProps } from "./diagram-types.ts"

type LessonNode = Node<{ readonly d: DiagramNode; readonly horizontal: boolean }, "lesson">

function LessonNodeView(props: NodeProps<LessonNode>) {
  const { d, horizontal } = props.data
  const style =
    d.part === undefined && d.color !== undefined ? ({ "--c": d.color } as CSSProperties) : undefined
  return (
    <>
      <Handle type="target" position={horizontal ? Position.Left : Position.Bottom} isConnectable={false} />
      <button
        type="button"
        className={`lsn-node lsn-node-${d.variant ?? "plain"}`}
        data-target={d.target}
        data-p={d.part}
        style={style}
        aria-label={d.text}
      >
        {d.label}
      </button>
      <Handle type="source" position={horizontal ? Position.Right : Position.Top} isConnectable={false} />
    </>
  )
}

const nodeTypes = { lesson: LessonNodeView }

export default function Diagram(props: DiagramProps) {
  const horizontal = props.direction === "LR"
  // React Flow's own parts (edge labels, controls) follow the reader's theme.
  const colorMode = useResolvedTheme()
  const { nodes, edges, height } = useMemo(() => {
    const sized = props.nodes.map((n) => ({ n, size: labelSize(n.text) }))
    const layout = layoutDiagram(
      sized.map(({ n, size }) => ({ id: n.id, ...size })),
      props.edges.map((e) => ({ from: e.from, to: e.to })),
      props.direction,
    )
    const rfNodes: Array<LessonNode> = sized.map(({ n, size }) => ({
      id: n.id,
      type: "lesson",
      position: layout.positions.get(n.id) ?? { x: 0, y: 0 },
      width: size.width,
      height: size.height,
      data: { d: n, horizontal },
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
    }))
    const rfEdges: Array<Edge> = props.edges.map((e) => {
      const color = e.color ?? "var(--color-hairline-strong)"
      return {
        id: e.id,
        source: e.from,
        target: e.to,
        animated: e.animated === true,
        className: "lsn-edge",
        ...(e.label === undefined ? {} : { label: e.label }),
        style: { stroke: color, strokeWidth: 1.4 },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        focusable: false,
        selectable: false,
      }
    })
    return { nodes: rfNodes, edges: rfEdges, height: Math.min(560, Math.max(180, layout.height + 40)) }
  }, [props.nodes, props.edges, props.direction, horizontal])

  return (
    <figure className="lsn-diagram" style={{ height }} aria-label={props.ariaLabel}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          colorMode={colorMode}
          fitView
          fitViewOptions={{ padding: 0.08 }}
          minZoom={0.2}
          maxZoom={1.6}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          zoomOnPinch
          preventScrolling={false}
        />
      </ReactFlowProvider>
    </figure>
  )
}
