import type { Section, VisualSection } from "@app/domain"
import { memo } from "react"
import { SectionFrame } from "../chrome.tsx"
import { FlowView, GraphView } from "../widgets/diagrams.tsx"
import { InclineView } from "../widgets/incline.tsx"
import { PlotView } from "../widgets/plot.tsx"
import { TableView, TraceView } from "../widgets/trace.tsx"
import {
  CheckView,
  ChunksView,
  ConceptView,
  PlanView,
  ProblemView,
  StoryView,
  TextView,
  UnitsView,
} from "./basic.tsx"
import { ChainView, ProofView, RecallView } from "./steps.tsx"

function VisualView(props: { readonly section: VisualSection }) {
  const s = props.section
  const w = s.widget
  const label = s.title ?? s.id
  return (
    <SectionFrame section={s}>
      {w.kind === "plot" && <PlotView widget={w} sectionId={s.id} label={label} />}
      {w.kind === "table" && <TableView widget={w} />}
      {w.kind === "flow" && <FlowView widget={w} sectionId={s.id} label={label} />}
      {w.kind === "incline" && <InclineView widget={w} label={label} />}
      {w.kind === "trace" && <TraceView widget={w} label={label} />}
    </SectionFrame>
  )
}

export const SectionView = memo(function SectionView(props: { readonly section: Section }) {
  const s = props.section
  switch (s.type) {
    case "text":
      return <TextView section={s} />
    case "problem":
      return <ProblemView section={s} />
    case "chunks":
      return <ChunksView section={s} />
    case "concept":
      return <ConceptView section={s} />
    case "plan":
      return <PlanView section={s} />
    case "chain":
      return <ChainView section={s} />
    case "proof":
      return <ProofView section={s} />
    case "graph":
      return <GraphView section={s} />
    case "visual":
      return <VisualView section={s} />
    case "check":
      return <CheckView section={s} />
    case "story":
      return <StoryView section={s} />
    case "units":
      return <UnitsView section={s} />
    case "recall":
      return <RecallView section={s} />
  }
})
