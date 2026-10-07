import { Schema } from "effect"

// LessonSpec: the one lesson format. pi writes it, the server validates and stores it (R2, by
// hash), the web renders it. It is data only: no HTML, no scripts. Rich text uses a small markup
// that `packages/lesson` parses with a fixed grammar:
//
//   [partId:label]     link to a part (label may contain $tex$)
//   {cardId|label}     link to a card (drill-down)
//   $tex$  $$tex$$     inline / display math (KaTeX); `\$` is a literal dollar
//   **bold** *italic* `code`
//   inside TeX: \p{partId}{tex}  marks a hoverable symbol linked to a part
//
// IDs are stable within a lesson and identical across its translations, so `@ref`s and comment
// anchors work in every language: `@<slug>/<sectionId>.<itemId>`.

export const lessonSchemaVersion = 1

const Id = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]{0,31}$/))
export const PartId = Id.pipe(Schema.brand("PartId"))
export type PartId = typeof PartId.Type
export const CardId = Id.pipe(Schema.brand("CardId"))
export type CardId = typeof CardId.Type

// Rich text. Length caps keep one field from becoming the whole 512 KB budget.
export const Rich = Schema.String.check(Schema.isMaxLength(8_000))
export type Rich = typeof Rich.Type
export const Tex = Schema.String.check(Schema.isMaxLength(4_000))

export const LessonKind = Schema.Literals(["solve", "learn", "situation", "code", "proof", "guide"])
export type LessonKind = typeof LessonKind.Type

export const LessonLang = Schema.Literals(["en", "th"])
export type LessonLang = typeof LessonLang.Type

// What a part is in the lesson. The renderer shows it as a badge; the color says which part it is.
export const Role = Schema.Literals([
  "given",
  "hidden_given",
  "goal",
  "derived",
  "constant",
  "condition",
  "actor",
  "metric",
  "variable",
  "concept",
])
export type Role = typeof Role.Type

// Role colors are tokens, not hex: the renderer maps them to a palette tuned for the theme.
// One color = one meaning inside a lesson.
export const RoleColor = Schema.Literals([
  "red",
  "orange",
  "peach",
  "yellow",
  "mustard",
  "olive",
  "green",
  "teal",
  "cyan",
  "blue",
  "purple",
  "pink",
  "rose",
  "grey",
])
export type RoleColor = typeof RoleColor.Type

export const Part = Schema.Struct({
  label: Rich,
  role: Role,
  color: RoleColor,
  meaning: Schema.String.check(Schema.isMaxLength(200)),
  body: Schema.optionalKey(Rich),
  example: Schema.optionalKey(Rich),
  analogy: Schema.optionalKey(Rich),
})
export type Part = typeof Part.Type

export const CardKind = Schema.Literals([
  "term",
  "law",
  "formula",
  "def",
  "lemma",
  "thm",
  "metric",
  "story",
  "feature",
])
export type CardKind = typeof CardKind.Type

// Child cards are the {card} links inside a card: that is the drill-down hierarchy.
export const Card = Schema.Struct({
  kind: CardKind,
  title: Rich,
  kicker: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(60))),
  body: Rich,
  says: Schema.optionalKey(Rich),
  from: Schema.optionalKey(Rich),
  useWhen: Schema.optionalKey(Rich),
  units: Schema.optionalKey(Rich),
  example: Schema.optionalKey(Rich),
  analogy: Schema.optionalKey(Rich),
})
export type Card = typeof Card.Type

// ── Shared concepts. A concept (e.g. Newton's 2nd law) is written once and reused by many
// lessons, so the lesson-writing agent searches /api/concepts before writing a card, and readers
// get one consistent explanation. A lesson keeps its own local card id (so `{newton2|…}` links
// work) and points it at the concept; the server pins the concept version at publish time.
export const ConceptSlug = Schema.String.check(Schema.isPattern(/^[a-z0-9-]+(\.[a-z0-9-]+){1,4}$/)).pipe(
  Schema.brand("ConceptSlug"),
)
export type ConceptSlug = typeof ConceptSlug.Type
// A slug with an optional version pin: `physics.newton-second-law` or `physics.newton-second-law@2`.
export const ConceptRef = Schema.String.check(
  Schema.isPattern(/^[a-z0-9-]+(\.[a-z0-9-]+){1,4}(@[1-9][0-9]*)?$/),
)
export type ConceptRef = typeof ConceptRef.Type

export const ConceptCardRef = Schema.Struct({ concept: ConceptRef })
export const CardEntry = Schema.Union([Card, ConceptCardRef])
export type CardEntry = typeof CardEntry.Type

export const ConceptSpec = Schema.Struct({
  schema: Schema.Literal(1),
  slug: ConceptSlug,
  lang: Schema.Literals(["en", "th"]),
  card: Card,
  // Prerequisite concepts: the global concept graph, and drill-down children in every lesson.
  needs: Schema.Array(ConceptSlug),
  // Other names people search for ("F = ma", "กฎข้อที่สองของนิวตัน").
  aliases: Schema.Array(Schema.String.check(Schema.isMaxLength(80))),
})
export type ConceptSpec = typeof ConceptSpec.Type

// ── Widgets: a closed catalog. Expressions use the renderer's safe parser (numbers, + - * / ^,
// parentheses, sin cos tan sqrt abs exp ln log min max floor ceil, pi, e, x, and param ids).
export const Expr = Schema.String.check(Schema.isMaxLength(300))

export const Param = Schema.Struct({
  id: Id,
  label: Rich,
  min: Schema.Finite,
  max: Schema.Finite,
  step: Schema.Finite,
  value: Schema.Finite,
  part: Schema.optionalKey(PartId),
})
export type Param = typeof Param.Type

const Axis = Schema.Struct({ min: Schema.Finite, max: Schema.Finite, label: Schema.optionalKey(Rich) })

export const PlotWidget = Schema.Struct({
  kind: Schema.Literal("plot"),
  x: Axis,
  y: Axis,
  params: Schema.Array(Param),
  curves: Schema.Array(
    Schema.Struct({ expr: Expr, part: Schema.optionalKey(PartId), label: Schema.optionalKey(Rich) }),
  ),
  points: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({ x: Expr, y: Expr, part: Schema.optionalKey(PartId), label: Schema.optionalKey(Rich) }),
    ),
  ),
  // Live readouts under the plot: label = expr, e.g. "speed" = d / t.
  readouts: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        label: Rich,
        expr: Expr,
        unit: Schema.optionalKey(Schema.String),
        part: Schema.optionalKey(PartId),
      }),
    ),
  ),
})

export const TableWidget = Schema.Struct({
  kind: Schema.Literal("table"),
  head: Schema.Array(Rich),
  rows: Schema.Array(Schema.Array(Rich)),
})

export const FlowWidget = Schema.Struct({
  kind: Schema.Literal("flow"),
  nodes: Schema.Array(
    Schema.Struct({
      id: Id,
      label: Rich,
      part: Schema.optionalKey(PartId),
      card: Schema.optionalKey(CardId),
    }),
  ),
  edges: Schema.Array(
    Schema.Struct({ from: Id, to: Id, label: Schema.optionalKey(Rich), part: Schema.optionalKey(PartId) }),
  ),
})

export const InclineWidget = Schema.Struct({
  kind: Schema.Literal("incline"),
  params: Schema.Array(Param),
  // Which force arrows to draw, each bound to a part for color and hover.
  forces: Schema.Array(Schema.Literals(["weight", "normal", "friction", "accel"])),
  parts: Schema.Record(Schema.String, PartId),
})

export const TraceWidget = Schema.Struct({
  kind: Schema.Literal("trace"),
  code: Schema.String.check(Schema.isMaxLength(4_000)),
  lang: Schema.String,
  steps: Schema.Array(
    Schema.Struct({ line: Schema.Int, note: Rich, state: Schema.Record(Schema.String, Schema.String) }),
  ),
})

export const Widget = Schema.Union([PlotWidget, TableWidget, FlowWidget, InclineWidget, TraceWidget])
export type Widget = typeof Widget.Type

// ── Sections
export const Step = Schema.Struct({
  id: Id,
  move: Rich,
  formula: Schema.optionalKey(Tex),
  why: Rich,
  whyNot: Schema.optionalKey(Rich),
  uses: Schema.Array(PartId),
})
export type Step = typeof Step.Type

export const ProofLine = Schema.Struct({
  id: Id,
  claim: Rich,
  why: Rich,
  intuition: Schema.optionalKey(Rich),
  whyNot: Schema.optionalKey(Rich),
  deps: Schema.Array(Id),
})
export type ProofLine = typeof ProofLine.Type

export const GraphNodeKind = Schema.Literals(["goal", "lemma", "thm", "law", "def", "part", "step"])

const sectionBase = {
  id: Id,
  title: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(120))),
  note: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
}

export const TextSection = Schema.Struct({ ...sectionBase, type: Schema.Literal("text"), body: Rich })
export const ProblemSection = Schema.Struct({ ...sectionBase, type: Schema.Literal("problem"), body: Rich })
export const ChunksSection = Schema.Struct({
  ...sectionBase,
  type: Schema.Literal("chunks"),
  rows: Schema.Array(Schema.Struct({ id: Id, text: Rich, role: Role, note: Rich })),
})
export const ConceptSection = Schema.Struct({
  ...sectionBase,
  type: Schema.Literal("concept"),
  concept: Rich,
  field: Rich,
  prerequisites: Schema.Array(CardId),
})
export const PlanSection = Schema.Struct({
  ...sectionBase,
  type: Schema.Literal("plan"),
  routes: Schema.Array(
    Schema.Struct({ id: Id, title: Rich, path: Rich, why: Rich, whyNot: Rich, picked: Schema.Boolean }),
  ),
  notUsed: Schema.optionalKey(Rich),
})
export const ChainSection = Schema.Struct({
  ...sectionBase,
  type: Schema.Literal("chain"),
  steps: Schema.Array(Step),
})
export const ProofSection = Schema.Struct({
  ...sectionBase,
  type: Schema.Literal("proof"),
  goal: Rich,
  lines: Schema.Array(ProofLine),
})
export const GraphSection = Schema.Struct({
  ...sectionBase,
  type: Schema.Literal("graph"),
  nodes: Schema.Array(
    Schema.Struct({
      id: Id,
      label: Schema.String.check(Schema.isMaxLength(60)),
      kind: GraphNodeKind,
      needs: Schema.Array(Id),
      card: Schema.optionalKey(CardId),
      part: Schema.optionalKey(PartId),
    }),
  ),
})
export const VisualSection = Schema.Struct({ ...sectionBase, type: Schema.Literal("visual"), widget: Widget })
export const CheckSection = Schema.Struct({
  ...sectionBase,
  type: Schema.Literal("check"),
  items: Schema.Array(Rich),
})
export const StorySection = Schema.Struct({
  ...sectionBase,
  type: Schema.Literal("story"),
  events: Schema.Array(Schema.Struct({ id: Id, year: Schema.optionalKey(Schema.String), text: Rich })),
})
export const UnitsSection = Schema.Struct({
  ...sectionBase,
  type: Schema.Literal("units"),
  units: Schema.Array(
    Schema.Struct({ id: Id, title: Rich, milestone: Rich, lessonSlug: Schema.optionalKey(Schema.String) }),
  ),
})
export const RecallSection = Schema.Struct({
  ...sectionBase,
  type: Schema.Literal("recall"),
  questions: Schema.Array(
    Schema.Struct({ id: Id, q: Rich, options: Schema.Array(Rich), answer: Schema.Int, why: Rich }),
  ),
})

export const Section = Schema.Union([
  TextSection,
  ProblemSection,
  ChunksSection,
  ConceptSection,
  PlanSection,
  ChainSection,
  ProofSection,
  GraphSection,
  VisualSection,
  CheckSection,
  StorySection,
  UnitsSection,
  RecallSection,
])
export type Section = typeof Section.Type

export const LessonSpec = Schema.Struct({
  schema: Schema.Literal(lessonSchemaVersion),
  kind: LessonKind,
  lang: LessonLang,
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(160)),
  summary: Schema.String.check(Schema.isMaxLength(280)),
  parts: Schema.Record(Schema.String, Part),
  cards: Schema.Record(Schema.String, CardEntry),
  sections: Schema.Array(Section),
})
export type LessonSpec = typeof LessonSpec.Type

// Serialized size cap, checked by the server before it stores a version.
export const maxLessonBytes = 512 * 1024
