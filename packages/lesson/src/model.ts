// The lesson model: one index over a LessonSpec (+ the shared concepts it points at) that the
// renderer, the inspector, the drill-down tree and the @ref / prompt builder all read.

import {
  type Card,
  type CardEntry,
  type ChunksSection,
  type ConceptSpec,
  type FlowWidget,
  type GraphSection,
  isConceptCardRef,
  type LessonSpec,
  type Part,
  type PlanSection,
  type ProofSection,
  parseConceptRef,
  parseRich,
  type RecallSection,
  type RichNode,
  richRefs,
  type Section,
  type Step,
  type StorySection,
  texPartIds,
  type UnitsSection,
} from "@app/domain"
import { texToText } from "./tex.ts"

// ── Targets: anything the inspector can show, the highlight can light, or a ref can point at.

export type Target =
  | { readonly kind: "part"; readonly id: string }
  | { readonly kind: "card"; readonly id: string }
  | { readonly kind: "concept"; readonly slug: string }
  | { readonly kind: "item"; readonly section: string; readonly item: string }
  | { readonly kind: "section"; readonly section: string }

/** A stable string for a target, used in `data-target` attributes and as a React key. */
export const targetKey = (t: Target): string => {
  switch (t.kind) {
    case "part":
      return `part:${t.id}`
    case "card":
      return `card:${t.id}`
    case "concept":
      return `concept:${t.slug}`
    case "item":
      return `item:${t.section}.${t.item}`
    case "section":
      return `section:${t.section}`
  }
}

/** Inverse of `targetKey`; undefined for anything malformed. */
export const parseTargetKey = (key: string): Target | undefined => {
  const at = key.indexOf(":")
  if (at === -1) return undefined
  const kind = key.slice(0, at)
  const rest = key.slice(at + 1)
  if (rest === "") return undefined
  switch (kind) {
    case "part":
      return { kind: "part", id: rest }
    case "card":
      return { kind: "card", id: rest }
    case "concept":
      return { kind: "concept", slug: rest }
    case "section":
      return { kind: "section", section: rest }
    case "item": {
      const dot = rest.indexOf(".")
      if (dot <= 0 || dot === rest.length - 1) return undefined
      return { kind: "item", section: rest.slice(0, dot), item: rest.slice(dot + 1) }
    }
    default:
      return undefined
  }
}

// ── Items: the `<itemId>` of `@slug/section.item`.

interface ItemBase {
  readonly sectionId: string
  readonly itemId: string
  /** 0-based position inside its section. */
  readonly index: number
}

export type ItemEntry =
  | (ItemBase & { readonly type: "chunks"; readonly row: ChunksSection["rows"][number] })
  | (ItemBase & { readonly type: "plan"; readonly route: PlanSection["routes"][number] })
  | (ItemBase & { readonly type: "chain"; readonly step: Step })
  | (ItemBase & {
      readonly type: "proof"
      readonly line: ProofSection["lines"][number]
      readonly section: ProofSection
    })
  | (ItemBase & {
      readonly type: "graph"
      readonly node: GraphSection["nodes"][number]
      readonly section: GraphSection
    })
  | (ItemBase & { readonly type: "story"; readonly event: StorySection["events"][number] })
  | (ItemBase & { readonly type: "units"; readonly unit: UnitsSection["units"][number] })
  | (ItemBase & { readonly type: "recall"; readonly question: RecallSection["questions"][number] })
  | (ItemBase & { readonly type: "flow"; readonly node: FlowWidget["nodes"][number] })

const sectionItems = (s: Section): ReadonlyArray<ItemEntry> => {
  const base = (itemId: string, index: number): ItemBase => ({ sectionId: s.id, itemId, index })
  switch (s.type) {
    case "chunks":
      return s.rows.map((row, i) => ({ ...base(row.id, i), type: "chunks", row }))
    case "plan":
      return s.routes.map((route, i) => ({ ...base(route.id, i), type: "plan", route }))
    case "chain":
      return s.steps.map((step, i) => ({ ...base(step.id, i), type: "chain", step }))
    case "proof":
      return s.lines.map((line, i) => ({ ...base(line.id, i), type: "proof", line, section: s }))
    case "graph":
      return s.nodes.map((node, i) => ({ ...base(node.id, i), type: "graph", node, section: s }))
    case "story":
      return s.events.map((event, i) => ({ ...base(event.id, i), type: "story", event }))
    case "units":
      return s.units.map((unit, i) => ({ ...base(unit.id, i), type: "units", unit }))
    case "recall":
      return s.questions.map((question, i) => ({ ...base(question.id, i), type: "recall", question }))
    case "visual":
      return s.widget.kind === "flow"
        ? s.widget.nodes.map((node, i) => ({ ...base(node.id, i), type: "flow", node }))
        : []
    default:
      return []
  }
}

// ── Cards: a local card, or a shared concept resolved from the `concepts` prop.

export interface ResolvedCard {
  readonly card: Card | undefined
  /** Set when the card is a shared concept. */
  readonly conceptSlug: string | undefined
  readonly concept: ConceptSpec | undefined
}

const cardFields = (c: Card): ReadonlyArray<string> =>
  [c.title, c.body, c.says, c.from, c.useWhen, c.units, c.example, c.analogy].filter(
    (v): v is string => v !== undefined,
  )

const partFields = (p: Part): ReadonlyArray<string> =>
  [p.label, p.body, p.example, p.analogy].filter((v): v is string => v !== undefined)

const unique = <A>(xs: ReadonlyArray<A>): ReadonlyArray<A> => [...new Set(xs)]

/** Part ids referenced anywhere in Rich strings: `[part:]` links and `\p{part}{}` in math. */
export const partsIn = (fields: ReadonlyArray<string>): ReadonlyArray<string> =>
  unique(
    fields.flatMap((f) => {
      const r = richRefs(f)
      return [...r.parts, ...r.texParts]
    }),
  )

const cardsIn = (fields: ReadonlyArray<string>): ReadonlyArray<string> =>
  unique(fields.flatMap((f) => richRefs(f).cards))

export interface LessonModel {
  readonly spec: LessonSpec
  readonly slug: string
  readonly sections: ReadonlyMap<string, Section>
  readonly items: ReadonlyMap<string, ItemEntry>
  /** Items of each section, in order. */
  readonly sectionItems: ReadonlyMap<string, ReadonlyArray<ItemEntry>>
  readonly part: (id: string) => Part | undefined
  readonly card: (id: string) => ResolvedCard | undefined
  readonly concept: (slug: string) => ConceptSpec | undefined
  /** The local card id that points at a concept slug, if the lesson has one. */
  readonly cardForConcept: (slug: string) => string | undefined
  readonly item: (section: string, item: string) => ItemEntry | undefined
  readonly conceptUses: (slug: string) => number | undefined
}

export interface ModelInput {
  readonly spec: LessonSpec
  readonly slug: string
  readonly concepts?: ReadonlyArray<ConceptSpec> | undefined
  readonly conceptUses?: Readonly<Record<string, number>> | undefined
}

export const buildModel = (input: ModelInput): LessonModel => {
  const { spec } = input
  const sections = new Map<string, Section>()
  const items = new Map<string, ItemEntry>()
  const bySection = new Map<string, ReadonlyArray<ItemEntry>>()
  for (const s of spec.sections) {
    sections.set(s.id, s)
    const list = sectionItems(s)
    bySection.set(s.id, list)
    for (const it of list) items.set(`${s.id}.${it.itemId}`, it)
  }
  // Prefer the concept in the lesson's language, fall back to any language.
  const concepts = new Map<string, ConceptSpec>()
  for (const c of input.concepts ?? []) {
    const have = concepts.get(c.slug)
    if (have === undefined || (have.lang !== spec.lang && c.lang === spec.lang)) concepts.set(c.slug, c)
  }
  const conceptCard = new Map<string, string>()
  for (const [id, entry] of Object.entries(spec.cards)) {
    if (isConceptCardRef(entry)) {
      const { slug } = parseConceptRef(entry.concept)
      if (!conceptCard.has(slug)) conceptCard.set(slug, id)
    }
  }
  const resolve = (entry: CardEntry): ResolvedCard => {
    if (!isConceptCardRef(entry)) return { card: entry, conceptSlug: undefined, concept: undefined }
    const { slug } = parseConceptRef(entry.concept)
    const concept = concepts.get(slug)
    return { card: concept?.card, conceptSlug: slug, concept }
  }
  return {
    spec,
    slug: input.slug,
    sections,
    items,
    sectionItems: bySection,
    part: (id) => (Object.hasOwn(spec.parts, id) ? spec.parts[id] : undefined),
    card: (id) => {
      if (!Object.hasOwn(spec.cards, id)) return undefined
      const entry = spec.cards[id]
      return entry === undefined ? undefined : resolve(entry)
    },
    concept: (slug) => concepts.get(slug),
    cardForConcept: (slug) => conceptCard.get(slug),
    item: (section, item) => items.get(`${section}.${item}`),
    conceptUses: (slug) => input.conceptUses?.[slug],
  }
}

// ── What a target lights up, what it links to, what it is called.

/** Parts an item mentions. A chain step uses exactly its `uses` list. */
export const itemParts = (it: ItemEntry): ReadonlyArray<string> => {
  switch (it.type) {
    case "chunks":
      return partsIn([it.row.text])
    case "plan":
      return partsIn([it.route.path])
    case "chain":
      return unique([...it.step.uses, ...(it.step.formula === undefined ? [] : texPartIds(it.step.formula))])
    case "proof":
      return partsIn([it.line.claim])
    case "graph":
      return it.node.part === undefined ? [] : [it.node.part]
    case "story":
      return partsIn([it.event.text])
    case "units":
      return partsIn([it.unit.title, it.unit.milestone])
    case "recall":
      return partsIn([it.question.q])
    case "flow":
      return it.node.part === undefined ? partsIn([it.node.label]) : [it.node.part]
  }
}

const itemFields = (it: ItemEntry): ReadonlyArray<string> => {
  switch (it.type) {
    case "chunks":
      return [it.row.text, it.row.note]
    case "plan":
      return [it.route.title, it.route.path, it.route.why, it.route.whyNot]
    case "chain":
      return [it.step.move, it.step.why, ...(it.step.whyNot === undefined ? [] : [it.step.whyNot])]
    case "proof":
      return [it.line.claim, it.line.why, it.line.intuition, it.line.whyNot].filter(
        (v): v is string => v !== undefined,
      )
    case "graph":
      return []
    case "story":
      return [it.event.text]
    case "units":
      return [it.unit.title, it.unit.milestone]
    case "recall":
      return [it.question.q, it.question.why]
    case "flow":
      return [it.node.label]
  }
}

/** Part ids to light up while a target is hovered or pinned. */
export const highlightFor = (model: LessonModel, t: Target | undefined): ReadonlyArray<string> => {
  if (t === undefined) return []
  switch (t.kind) {
    case "part":
      return model.part(t.id) === undefined ? [] : [t.id]
    case "card": {
      const c = model.card(t.id)?.card
      return c === undefined ? [] : partsIn(cardFields(c)).filter((id) => model.part(id) !== undefined)
    }
    case "concept":
      return []
    case "item": {
      const it = model.item(t.section, t.item)
      return it === undefined ? [] : itemParts(it).filter((id) => model.part(id) !== undefined)
    }
    case "section":
      return []
  }
}

/**
 * Drill-down children: the cards a target links to with `{card|…}`, and for a shared concept its
 * `needs` (as the lesson's local card when it has one, else as a concept).
 */
export const childrenOf = (model: LessonModel, t: Target): ReadonlyArray<Target> => {
  const fromCards = (ids: ReadonlyArray<string>, self?: string): Array<Target> =>
    ids.filter((id) => id !== self && model.card(id) !== undefined).map((id) => ({ kind: "card", id }))
  const fromNeeds = (concept: ConceptSpec | undefined): Array<Target> =>
    (concept?.needs ?? []).map((slug): Target => {
      const local = model.cardForConcept(slug)
      return local === undefined ? { kind: "concept", slug } : { kind: "card", id: local }
    })
  const dedupe = (ts: ReadonlyArray<Target>): ReadonlyArray<Target> => {
    const seen = new Set<string>()
    return ts.filter((x) => {
      const k = targetKey(x)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }
  switch (t.kind) {
    case "card": {
      const r = model.card(t.id)
      if (r === undefined) return []
      const linked = r.card === undefined ? [] : fromCards(cardsIn(cardFields(r.card)), t.id)
      return dedupe([...linked, ...fromNeeds(r.concept)])
    }
    case "concept": {
      const c = model.concept(t.slug)
      return dedupe([...(c === undefined ? [] : fromCards(cardsIn(cardFields(c.card)))), ...fromNeeds(c)])
    }
    case "part": {
      const p = model.part(t.id)
      return p === undefined ? [] : dedupe(fromCards(cardsIn(partFields(p))))
    }
    case "item": {
      const it = model.item(t.section, t.item)
      if (it === undefined) return []
      const extra: Array<Target> =
        (it.type === "graph" || it.type === "flow") && it.node.card !== undefined
          ? [{ kind: "card", id: it.node.card }]
          : []
      return dedupe([...extra, ...fromCards(cardsIn(itemFields(it)))])
    }
    case "section": {
      const s = model.sections.get(t.section)
      return s?.type === "concept" ? dedupe(fromCards(s.prerequisites)) : []
    }
  }
}

/** The Rich title of a target (for the inspector header, the tree, ref suggestions). */
export const titleOf = (model: LessonModel, t: Target): string => {
  switch (t.kind) {
    case "part":
      return model.part(t.id)?.label ?? t.id
    case "card": {
      const r = model.card(t.id)
      return r?.card?.title ?? r?.conceptSlug ?? t.id
    }
    case "concept":
      return model.concept(t.slug)?.card.title ?? t.slug
    case "section":
      return model.sections.get(t.section)?.title ?? t.section
    case "item": {
      const it = model.item(t.section, t.item)
      if (it === undefined) return t.item
      switch (it.type) {
        case "chunks":
          return it.row.text
        case "plan":
          return it.route.title
        case "chain":
          return it.step.move
        case "proof":
          return it.line.claim
        case "graph":
          return it.node.label
        case "story":
          return it.event.year === undefined ? it.event.text : `${it.event.year}: ${it.event.text}`
        case "units":
          return it.unit.title
        case "recall":
          return it.question.q
        case "flow":
          return it.node.label
      }
    }
  }
}

/**
 * Readable plain text of a Rich string, math included (`$\bar v$` → `v̄`, not TeX), for places
 * that cannot render markup: tooltips, aria labels, search, layout sizing.
 */
export const richText = (src: string): string => {
  const walk = (nodes: ReadonlyArray<RichNode>): string =>
    nodes
      .map((n) => {
        switch (n.type) {
          case "text":
          case "code":
            return n.text
          case "math":
            return texToText(n.tex)
          default:
            return walk(n.children)
        }
      })
      .join("")
  return walk(parseRich(src)).replace(/\s+/g, " ").trim()
}

/**
 * Plain-text title, shortened, for tooltips and search. Where markup can render, use
 * `<TargetTitle>` instead so math shows as math.
 */
export const plainTitle = (model: LessonModel, t: Target, max = 48): string => {
  const s = richText(titleOf(model, t))
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** Every target a learner can reference, in document order (for the @ suggestion list). */
export const referenceableTargets = (model: LessonModel): ReadonlyArray<Target> => {
  const out: Array<Target> = []
  for (const s of model.spec.sections) {
    out.push({ kind: "section", section: s.id })
    for (const it of model.sectionItems.get(s.id) ?? []) {
      out.push({ kind: "item", section: s.id, item: it.itemId })
    }
  }
  for (const id of Object.keys(model.spec.parts)) out.push({ kind: "part", id })
  for (const id of Object.keys(model.spec.cards)) out.push({ kind: "card", id })
  return out
}
