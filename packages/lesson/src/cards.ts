import {
  type Card,
  isConceptRef,
  type LessonSpec,
  type Part,
  type PinnedConcept,
  parseConceptRef,
  richRefs,
} from "@app/domain"

// What the inspector can show: a lesson card, a part, or a shared concept reached through `needs`.
export type Target =
  | { readonly k: "card"; readonly id: string }
  | { readonly k: "part"; readonly id: string }
  | { readonly k: "concept"; readonly slug: string }

export type Resolved =
  | { readonly k: "part"; readonly target: Target; readonly id: string; readonly part: Part }
  | { readonly k: "card"; readonly target: Target; readonly id: string; readonly card: Card }
  | {
      readonly k: "concept"
      readonly target: Target
      readonly slug: string
      // The lesson's local card id, when the concept was reached through a lesson card.
      readonly cardId: string | undefined
      readonly pinned: PinnedConcept
      readonly card: Card
    }
  | { readonly k: "missing"; readonly target: Target }

export const targetKey = (t: Target): string => (t.k === "concept" ? `concept:${t.slug}` : `${t.k}:${t.id}`)

export const sameTarget = (a: Target, b: Target) => targetKey(a) === targetKey(b)

// The `@ref` item key for a target: `cards.<id>`, `parts.<id>` or `concepts.<slug>`.
export const targetRefKey = (t: Target): string =>
  t.k === "concept" ? `concepts.${t.slug}` : t.k === "card" ? `cards.${t.id}` : `parts.${t.id}`

// Prefers the concept in the lesson's language, then any language.
export function findConcept(
  concepts: ReadonlyArray<PinnedConcept>,
  slug: string,
  lang: string,
): PinnedConcept | undefined {
  return (
    concepts.find((c) => c.slug === slug && c.spec.lang === lang) ?? concepts.find((c) => c.slug === slug)
  )
}

export function resolveTarget(t: Target, spec: LessonSpec, concepts: ReadonlyArray<PinnedConcept>): Resolved {
  if (t.k === "part") {
    const part = Object.hasOwn(spec.parts, t.id) ? spec.parts[t.id] : undefined
    return part ? { k: "part", target: t, id: t.id, part } : { k: "missing", target: t }
  }
  if (t.k === "concept") {
    const pinned = findConcept(concepts, t.slug, spec.lang)
    return pinned
      ? { k: "concept", target: t, slug: t.slug, cardId: undefined, pinned, card: pinned.spec.card }
      : { k: "missing", target: t }
  }
  const entry = Object.hasOwn(spec.cards, t.id) ? spec.cards[t.id] : undefined
  if (entry === undefined) return { k: "missing", target: t }
  if (!isConceptRef(entry)) return { k: "card", target: t, id: t.id, card: entry }
  const { slug } = parseConceptRef(entry.concept)
  const pinned = findConcept(concepts, slug, spec.lang)
  return pinned
    ? { k: "concept", target: t, slug, cardId: t.id, pinned, card: pinned.spec.card }
    : { k: "missing", target: t }
}

const cardTextKeys = ["title", "body", "says", "from", "useWhen", "units", "example", "analogy"] as const
const partTextKeys = ["label", "body", "example", "analogy"] as const

function richCardLinks(texts: ReadonlyArray<string | undefined>): Array<string> {
  return texts.flatMap((t) => (t === undefined ? [] : richRefs(t).cards))
}

// The lesson card that points at a concept, so a `need` opens with the lesson's own card id.
function lessonCardForConcept(spec: LessonSpec, slug: string): string | undefined {
  for (const [id, entry] of Object.entries(spec.cards)) {
    if (isConceptRef(entry) && parseConceptRef(entry.concept).slug === slug) return id
  }
  return undefined
}

// Drill-down children: the `{card}` links inside a card's text, then (for shared concepts) its
// `needs`. Only children that resolve are returned, each once, never the card itself.
export function cardChildren(
  t: Target,
  spec: LessonSpec,
  concepts: ReadonlyArray<PinnedConcept>,
): Array<Target> {
  const r = resolveTarget(t, spec, concepts)
  if (r.k === "missing") return []
  const links =
    r.k === "part"
      ? richCardLinks(partTextKeys.map((k) => r.part[k]))
      : richCardLinks(cardTextKeys.map((k) => r.card[k]))
  const out: Array<Target> = links.map((id) => ({ k: "card", id }))
  if (r.k === "concept") {
    for (const need of r.pinned.spec.needs) {
      const id = lessonCardForConcept(spec, need)
      out.push(id === undefined ? { k: "concept", slug: need } : { k: "card", id })
    }
  }
  const self = conceptIdentity(r)
  const seen = new Set<string>([self])
  return out.filter((c) => {
    const child = resolveTarget(c, spec, concepts)
    if (child.k === "missing") return false
    const key = conceptIdentity(child)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Two targets that show the same concept (a lesson card and a `need`) count as one.
function conceptIdentity(r: Resolved): string {
  return r.k === "concept" ? `concept:${r.slug}` : targetKey(r.target)
}
