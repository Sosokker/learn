// One shared validator for what the Schema cannot say: references between parts of a lesson,
// plot expressions, value ranges, id uniqueness, translation parity and the concept graph.
// The server runs it on publish, pi runs it before publishing, the content test runs it on
// `content/**`. Input is an already decoded spec (`decodeLesson` / `decodeConcept`).
//
// Paths are JSON-path-ish: `sections[6].steps[0].uses[2]`, `parts.t2.body`, `cards.f_part.title`.

import { Result } from "effect"
import { freeVars, isReservedName, parseExpr } from "./expr.ts"
import type { Card, CardEntry, ConceptSpec, LessonSpec, Param, Section, Widget } from "./lesson.ts"
import { isId, richRefs, texPartIds } from "./rich.ts"

export type IssueCode =
  | "bad_id" // a record key that must be an id is not one
  | "duplicate_id" // two items with one id where ids must be unique
  | "unknown_part" // [part:], \p{part}{}, uses, or a widget/graph `part` binding has no part
  | "unknown_card" // {card|}, a prerequisite or a `card` binding has no card
  | "unknown_concept" // a {concept} card entry or concept `needs` does not resolve
  | "unknown_ref" // a proof dep, graph need, or flow edge end has no target
  | "forward_dep" // a proof line depends on itself or a later line
  | "cycle" // a graph section or the concept graph has a cycle
  | "bad_expr" // a plot expression does not parse
  | "unknown_var" // a plot expression uses a name that is not x or a param
  | "bad_range" // min/max/step/value, recall answer, or trace line out of range
  | "not_allowed" // markup that a field may not use (e.g. links in a shared concept card)
  | "parity" // en/th translations differ in structure

export interface Issue {
  readonly path: string
  readonly code: IssueCode
  readonly message: string
}

/** Parsed `{ concept: "slug@2" }`. */
export const parseConceptRef = (
  ref: string,
): { readonly slug: string; readonly version: number | undefined } => {
  const at = ref.indexOf("@")
  if (at === -1) return { slug: ref, version: undefined }
  return { slug: ref.slice(0, at), version: Number(ref.slice(at + 1)) }
}

export const isConceptCardRef = (entry: CardEntry): entry is { readonly concept: string } =>
  "concept" in entry

// ── Walking every Rich / Tex field

export type FieldKind = "rich" | "tex"
export type FieldVisitor = (path: string, value: string, kind: FieldKind) => void

const visitCard = (card: Card, path: string, visit: FieldVisitor): void => {
  visit(`${path}.title`, card.title, "rich")
  visit(`${path}.body`, card.body, "rich")
  for (const key of ["says", "from", "useWhen", "units", "example", "analogy"] as const) {
    const v = card[key]
    if (v !== undefined) visit(`${path}.${key}`, v, "rich")
  }
}

const visitParams = (params: ReadonlyArray<Param>, path: string, visit: FieldVisitor): void => {
  params.forEach((p, i) => {
    visit(`${path}[${i}].label`, p.label, "rich")
  })
}

const visitWidget = (w: Widget, path: string, visit: FieldVisitor): void => {
  switch (w.kind) {
    case "plot": {
      if (w.x.label !== undefined) visit(`${path}.x.label`, w.x.label, "rich")
      if (w.y.label !== undefined) visit(`${path}.y.label`, w.y.label, "rich")
      visitParams(w.params, `${path}.params`, visit)
      const labelled = [
        ["curves", w.curves],
        ["points", w.points ?? []],
        ["readouts", w.readouts ?? []],
      ] as const
      for (const [key, items] of labelled) {
        items.forEach((item: { readonly label?: string }, i: number) => {
          if (item.label !== undefined) visit(`${path}.${key}[${i}].label`, item.label, "rich")
        })
      }
      break
    }
    case "table":
      w.head.forEach((h, i) => {
        visit(`${path}.head[${i}]`, h, "rich")
      })
      w.rows.forEach((row, r) => {
        row.forEach((cell, c) => {
          visit(`${path}.rows[${r}][${c}]`, cell, "rich")
        })
      })
      break
    case "flow":
      w.nodes.forEach((n, i) => {
        visit(`${path}.nodes[${i}].label`, n.label, "rich")
      })
      w.edges.forEach((e, i) => {
        if (e.label !== undefined) visit(`${path}.edges[${i}].label`, e.label, "rich")
      })
      break
    case "incline":
      visitParams(w.params, `${path}.params`, visit)
      break
    case "trace":
      w.steps.forEach((s, i) => {
        visit(`${path}.steps[${i}].note`, s.note, "rich")
      })
      break
  }
}

const visitSection = (s: Section, path: string, visit: FieldVisitor): void => {
  const opt = (p: string, v: string | undefined) => {
    if (v !== undefined) visit(p, v, "rich")
  }
  switch (s.type) {
    case "text":
    case "problem":
      visit(`${path}.body`, s.body, "rich")
      break
    case "chunks":
      s.rows.forEach((r, i) => {
        visit(`${path}.rows[${i}].text`, r.text, "rich")
        visit(`${path}.rows[${i}].note`, r.note, "rich")
      })
      break
    case "concept":
      visit(`${path}.concept`, s.concept, "rich")
      visit(`${path}.field`, s.field, "rich")
      break
    case "plan":
      s.routes.forEach((r, i) => {
        for (const key of ["title", "path", "why", "whyNot"] as const)
          visit(`${path}.routes[${i}].${key}`, r[key], "rich")
      })
      opt(`${path}.notUsed`, s.notUsed)
      break
    case "chain":
      s.steps.forEach((st, i) => {
        const p = `${path}.steps[${i}]`
        visit(`${p}.move`, st.move, "rich")
        if (st.formula !== undefined) visit(`${p}.formula`, st.formula, "tex")
        visit(`${p}.why`, st.why, "rich")
        opt(`${p}.whyNot`, st.whyNot)
      })
      break
    case "proof":
      visit(`${path}.goal`, s.goal, "rich")
      s.lines.forEach((l, i) => {
        const p = `${path}.lines[${i}]`
        visit(`${p}.claim`, l.claim, "rich")
        visit(`${p}.why`, l.why, "rich")
        opt(`${p}.intuition`, l.intuition)
        opt(`${p}.whyNot`, l.whyNot)
      })
      break
    case "graph":
      break
    case "visual":
      visitWidget(s.widget, `${path}.widget`, visit)
      break
    case "check":
      s.items.forEach((item, i) => {
        visit(`${path}.items[${i}]`, item, "rich")
      })
      break
    case "story":
      s.events.forEach((e, i) => {
        visit(`${path}.events[${i}].text`, e.text, "rich")
      })
      break
    case "units":
      s.units.forEach((u, i) => {
        visit(`${path}.units[${i}].title`, u.title, "rich")
        visit(`${path}.units[${i}].milestone`, u.milestone, "rich")
      })
      break
    case "recall":
      s.questions.forEach((q, i) => {
        const p = `${path}.questions[${i}]`
        visit(`${p}.q`, q.q, "rich")
        q.options.forEach((o, k) => {
          visit(`${p}.options[${k}]`, o, "rich")
        })
        visit(`${p}.why`, q.why, "rich")
      })
      break
  }
}

/** Visit every Rich and Tex field of a lesson, in document order. */
export const forEachLessonField = (spec: LessonSpec, visit: FieldVisitor): void => {
  for (const [id, part] of Object.entries(spec.parts)) {
    const p = `parts.${id}`
    visit(`${p}.label`, part.label, "rich")
    for (const key of ["body", "example", "analogy"] as const) {
      const v = part[key]
      if (v !== undefined) visit(`${p}.${key}`, v, "rich")
    }
  }
  for (const [id, entry] of Object.entries(spec.cards)) {
    if (!isConceptCardRef(entry)) visitCard(entry, `cards.${id}`, visit)
  }
  spec.sections.forEach((s, i) => {
    visitSection(s, `sections[${i}]`, visit)
  })
}

/** The item ids of a section (steps, lines, rows, …), the `<itemId>` of `@slug/section.item`. */
export const sectionItemIds = (s: Section): ReadonlyArray<string> => {
  switch (s.type) {
    case "chunks":
      return s.rows.map((r) => r.id)
    case "plan":
      return s.routes.map((r) => r.id)
    case "chain":
      return s.steps.map((r) => r.id)
    case "proof":
      return s.lines.map((r) => r.id)
    case "graph":
      return s.nodes.map((r) => r.id)
    case "story":
      return s.events.map((r) => r.id)
    case "units":
      return s.units.map((r) => r.id)
    case "recall":
      return s.questions.map((r) => r.id)
    case "visual":
      return s.widget.kind === "flow" ? s.widget.nodes.map((n) => n.id) : []
    default:
      return []
  }
}

const itemKey: Partial<Record<Section["type"], string>> = {
  chunks: "rows",
  plan: "routes",
  chain: "steps",
  proof: "lines",
  graph: "nodes",
  story: "events",
  units: "units",
  recall: "questions",
}

// ── Helpers

class Issues {
  readonly list: Array<Issue> = []
  add(path: string, code: IssueCode, message: string): void {
    this.list.push({ path, code, message })
  }
}

const duplicates = (ids: ReadonlyArray<string>): Array<[string, number]> => {
  const seen = new Set<string>()
  const out: Array<[string, number]> = []
  ids.forEach((id, i) => {
    if (seen.has(id)) out.push([id, i])
    seen.add(id)
  })
  return out
}

// Cycles in a directed graph given as node -> needs. Returns each cycle once, as a node list.
const findCycles = (edges: ReadonlyMap<string, ReadonlyArray<string>>): Array<Array<string>> => {
  const state = new Map<string, "open" | "done">()
  const stack: Array<string> = []
  const cycles: Array<Array<string>> = []
  const visit = (node: string): void => {
    state.set(node, "open")
    stack.push(node)
    for (const next of edges.get(node) ?? []) {
      if (!edges.has(next)) continue
      const st = state.get(next)
      if (st === "open") cycles.push([...stack.slice(stack.indexOf(next)), next])
      else if (st === undefined) visit(next)
    }
    stack.pop()
    state.set(node, "done")
  }
  for (const node of edges.keys()) if (!state.has(node)) visit(node)
  return cycles
}

// ── Lesson validation

export interface ValidateOptions {
  /**
   * Resolves a `{ concept: "slug@version" }` card entry. Return false when it does not exist.
   * Omit to skip concept resolution (e.g. pi validating offline).
   */
  readonly resolveConcept?: (slug: string, version: number | undefined) => boolean
}

const plotX = "x"

const checkParams = (
  params: ReadonlyArray<Param>,
  path: string,
  hasPart: (id: string) => boolean,
  issues: Issues,
): void => {
  for (const [id, i] of duplicates(params.map((p) => p.id))) {
    issues.add(`${path}[${i}].id`, "duplicate_id", `param "${id}" is declared twice`)
  }
  params.forEach((p, i) => {
    const pp = `${path}[${i}]`
    if (p.id === plotX || isReservedName(p.id)) {
      issues.add(`${pp}.id`, "bad_id", `param id "${p.id}" is reserved (x, pi, e and function names)`)
    }
    if (!(p.min < p.max)) issues.add(pp, "bad_range", `min ${p.min} must be below max ${p.max}`)
    if (!(p.step > 0)) issues.add(`${pp}.step`, "bad_range", `step ${p.step} must be positive`)
    if (p.value < p.min || p.value > p.max) {
      issues.add(`${pp}.value`, "bad_range", `value ${p.value} is outside [${p.min}, ${p.max}]`)
    }
    if (p.part !== undefined && !hasPart(p.part))
      issues.add(`${pp}.part`, "unknown_part", `no part "${p.part}"`)
  })
}

const checkExpr = (src: string, path: string, allowed: ReadonlySet<string>, issues: Issues): void => {
  const parsed = parseExpr(src)
  if (Result.isFailure(parsed)) {
    issues.add(path, "bad_expr", parsed.failure.message)
    return
  }
  for (const name of freeVars(parsed.success)) {
    if (!allowed.has(name)) {
      const known = [...allowed].sort().join(", ")
      issues.add(path, "unknown_var", `"${name}" is not a param here (allowed: ${known || "none"})`)
    }
  }
}

const checkWidget = (
  w: Widget,
  path: string,
  hasPart: (id: string) => boolean,
  hasCard: (id: string) => boolean,
  issues: Issues,
): void => {
  const part = (p: string, id: string | undefined) => {
    if (id !== undefined && !hasPart(id)) issues.add(p, "unknown_part", `no part "${id}"`)
  }
  switch (w.kind) {
    case "plot": {
      for (const axis of ["x", "y"] as const) {
        const a = w[axis]
        if (!(a.min < a.max))
          issues.add(`${path}.${axis}`, "bad_range", `axis min ${a.min} must be below max ${a.max}`)
      }
      checkParams(w.params, `${path}.params`, hasPart, issues)
      const params = new Set(w.params.map((p) => p.id))
      const withX = new Set([...params, plotX])
      w.curves.forEach((c, i) => {
        checkExpr(c.expr, `${path}.curves[${i}].expr`, withX, issues)
        part(`${path}.curves[${i}].part`, c.part)
      })
      ;(w.points ?? []).forEach((pt, i) => {
        checkExpr(pt.x, `${path}.points[${i}].x`, params, issues)
        checkExpr(pt.y, `${path}.points[${i}].y`, params, issues)
        part(`${path}.points[${i}].part`, pt.part)
      })
      ;(w.readouts ?? []).forEach((r, i) => {
        checkExpr(r.expr, `${path}.readouts[${i}].expr`, params, issues)
        part(`${path}.readouts[${i}].part`, r.part)
      })
      break
    }
    case "table":
      w.rows.forEach((row, r) => {
        if (row.length !== w.head.length) {
          issues.add(
            `${path}.rows[${r}]`,
            "bad_range",
            `row has ${row.length} cells, head has ${w.head.length}`,
          )
        }
      })
      break
    case "flow": {
      const ids = new Set(w.nodes.map((n) => n.id))
      for (const [id, i] of duplicates(w.nodes.map((n) => n.id))) {
        issues.add(`${path}.nodes[${i}].id`, "duplicate_id", `flow node "${id}" is declared twice`)
      }
      w.nodes.forEach((n, i) => {
        part(`${path}.nodes[${i}].part`, n.part)
        if (n.card !== undefined && !hasCard(n.card))
          issues.add(`${path}.nodes[${i}].card`, "unknown_card", `no card "${n.card}"`)
      })
      w.edges.forEach((e, i) => {
        for (const end of ["from", "to"] as const) {
          if (!ids.has(e[end]))
            issues.add(`${path}.edges[${i}].${end}`, "unknown_ref", `no flow node "${e[end]}"`)
        }
        part(`${path}.edges[${i}].part`, e.part)
      })
      break
    }
    case "incline": {
      checkParams(w.params, `${path}.params`, hasPart, issues)
      const forces = new Set<string>(w.forces)
      for (const [force, id] of Object.entries(w.parts)) {
        if (!forces.has(force))
          issues.add(`${path}.parts.${force}`, "unknown_ref", `"${force}" is not in forces`)
        part(`${path}.parts.${force}`, id)
      }
      break
    }
    case "trace": {
      const lines = w.code.split("\n").length
      w.steps.forEach((s, i) => {
        if (s.line < 1 || s.line > lines) {
          issues.add(
            `${path}.steps[${i}].line`,
            "bad_range",
            `line ${s.line} is outside 1..${lines} (lines are 1-based)`,
          )
        }
      })
      break
    }
  }
}

/** Check every reference, id and expression in a decoded lesson. Empty list = valid. */
export const validateLesson = (spec: LessonSpec, options: ValidateOptions = {}): ReadonlyArray<Issue> => {
  const issues = new Issues()
  const hasPart = (id: string) => Object.hasOwn(spec.parts, id)
  const hasCard = (id: string) => Object.hasOwn(spec.cards, id)

  for (const id of Object.keys(spec.parts)) {
    if (!isId(id)) issues.add(`parts.${id}`, "bad_id", `part id "${id}" must match ^[a-z][a-z0-9_]{0,31}$`)
  }
  for (const [id, entry] of Object.entries(spec.cards)) {
    if (!isId(id)) issues.add(`cards.${id}`, "bad_id", `card id "${id}" must match ^[a-z][a-z0-9_]{0,31}$`)
    if (isConceptCardRef(entry) && options.resolveConcept !== undefined) {
      const { slug, version } = parseConceptRef(entry.concept)
      if (!options.resolveConcept(slug, version)) {
        issues.add(`cards.${id}.concept`, "unknown_concept", `concept "${entry.concept}" does not exist`)
      }
    }
  }

  forEachLessonField(spec, (path, value, kind) => {
    const refs = kind === "rich" ? richRefs(value) : { parts: [], cards: [], texParts: texPartIds(value) }
    for (const id of refs.parts)
      if (!hasPart(id)) issues.add(path, "unknown_part", `[${id}:…] links to no part`)
    for (const id of refs.texParts)
      if (!hasPart(id)) issues.add(path, "unknown_part", `\\p{${id}} links to no part`)
    for (const id of refs.cards)
      if (!hasCard(id)) issues.add(path, "unknown_card", `{${id}|…} links to no card`)
  })

  for (const [id, i] of duplicates(spec.sections.map((s) => s.id))) {
    issues.add(`sections[${i}].id`, "duplicate_id", `section "${id}" is declared twice`)
  }

  spec.sections.forEach((s, si) => {
    const path = `sections[${si}]`
    const key = itemKey[s.type]
    if (key !== undefined) {
      for (const [id, i] of duplicates(sectionItemIds(s))) {
        issues.add(
          `${path}.${key}[${i}].id`,
          "duplicate_id",
          `"${id}" is declared twice in section "${s.id}"`,
        )
      }
    }
    switch (s.type) {
      case "concept":
        s.prerequisites.forEach((id, i) => {
          if (!hasCard(id)) issues.add(`${path}.prerequisites[${i}]`, "unknown_card", `no card "${id}"`)
        })
        break
      case "chain":
        s.steps.forEach((st, i) => {
          st.uses.forEach((id, k) => {
            if (!hasPart(id)) issues.add(`${path}.steps[${i}].uses[${k}]`, "unknown_part", `no part "${id}"`)
          })
        })
        break
      case "proof": {
        const index = new Map(s.lines.map((l, i) => [l.id, i] as const))
        s.lines.forEach((l, i) => {
          l.deps.forEach((dep, k) => {
            const p = `${path}.lines[${i}].deps[${k}]`
            const at = index.get(dep)
            if (at === undefined) issues.add(p, "unknown_ref", `no line "${dep}" in proof "${s.id}"`)
            else if (at >= i)
              issues.add(p, "forward_dep", `line "${l.id}" depends on "${dep}", which is not earlier`)
          })
        })
        break
      }
      case "graph": {
        const ids = new Set(s.nodes.map((n) => n.id))
        s.nodes.forEach((n, i) => {
          const p = `${path}.nodes[${i}]`
          n.needs.forEach((need, k) => {
            if (!ids.has(need))
              issues.add(`${p}.needs[${k}]`, "unknown_ref", `no node "${need}" in graph "${s.id}"`)
          })
          if (n.card !== undefined && !hasCard(n.card))
            issues.add(`${p}.card`, "unknown_card", `no card "${n.card}"`)
          if (n.part !== undefined && !hasPart(n.part))
            issues.add(`${p}.part`, "unknown_part", `no part "${n.part}"`)
        })
        for (const cycle of findCycles(new Map(s.nodes.map((n) => [n.id, n.needs])))) {
          issues.add(`${path}.nodes`, "cycle", `graph "${s.id}" has a cycle: ${cycle.join(" → ")}`)
        }
        break
      }
      case "visual":
        checkWidget(s.widget, `${path}.widget`, hasPart, hasCard, issues)
        break
      case "recall":
        s.questions.forEach((q, i) => {
          if (q.answer < 0 || q.answer >= q.options.length) {
            issues.add(
              `${path}.questions[${i}].answer`,
              "bad_range",
              `answer ${q.answer} is not an index into ${q.options.length} options`,
            )
          }
        })
        break
      default:
        break
    }
  })

  return issues.list
}

// ── Translation parity

const sameList = (a: ReadonlyArray<unknown>, b: ReadonlyArray<unknown>) =>
  a.length === b.length && a.every((x, i) => x === b[i])
const sameSet = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => {
  const sa = new Set(a)
  const sb = new Set(b)
  return sa.size === sb.size && [...sa].every((x) => sb.has(x))
}
const show = (xs: ReadonlyArray<unknown>) => `[${xs.join(", ")}]`

// The language-neutral shape of a widget: everything except prose labels and units.
const widgetShape = (w: Widget): unknown => {
  switch (w.kind) {
    case "plot":
      return {
        kind: w.kind,
        x: [w.x.min, w.x.max],
        y: [w.y.min, w.y.max],
        params: w.params.map((p) => [p.id, p.min, p.max, p.step, p.value, p.part]),
        curves: w.curves.map((c) => [c.expr, c.part]),
        points: (w.points ?? []).map((p) => [p.x, p.y, p.part]),
        readouts: (w.readouts ?? []).map((r) => [r.expr, r.part]),
      }
    case "table":
      return { kind: w.kind, head: w.head.length, rows: w.rows.map((r) => r.length) }
    case "flow":
      return {
        kind: w.kind,
        nodes: w.nodes.map((n) => [n.id, n.part, n.card]),
        edges: w.edges.map((e) => [e.from, e.to, e.part]),
      }
    case "incline":
      return {
        kind: w.kind,
        params: w.params.map((p) => [p.id, p.min, p.max, p.step, p.value, p.part]),
        forces: w.forces,
        parts: Object.entries(w.parts).sort(),
      }
    case "trace":
      return { kind: w.kind, code: w.code, lang: w.lang, steps: w.steps.map((s) => [s.line, s.state]) }
  }
}

// The language-neutral shape of a section: ids, types and links, no prose.
const sectionShape = (s: Section): unknown => {
  switch (s.type) {
    case "chunks":
      return s.rows.map((r) => [r.id, r.role])
    case "concept":
      return s.prerequisites
    case "plan":
      return s.routes.map((r) => [r.id, r.picked])
    case "chain":
      return s.steps.map((st) => [st.id, st.uses, st.formula !== undefined])
    case "proof":
      return s.lines.map((l) => [l.id, l.deps])
    case "graph":
      return s.nodes.map((n) => [n.id, n.kind, n.needs, n.card, n.part])
    case "visual":
      return widgetShape(s.widget)
    case "check":
      return s.items.length
    case "story":
      return s.events.map((e) => [e.id, e.year !== undefined])
    case "units":
      return s.units.map((u) => [u.id, u.lessonSlug])
    case "recall":
      return s.questions.map((q) => [q.id, q.options.length, q.answer])
    default:
      return null
  }
}

const fieldRefs = (
  spec: LessonSpec,
): Map<string, { parts: ReadonlyArray<string>; cards: ReadonlyArray<string> }> => {
  const out = new Map<string, { parts: ReadonlyArray<string>; cards: ReadonlyArray<string> }>()
  forEachLessonField(spec, (path, value, kind) => {
    if (kind === "rich") {
      const r = richRefs(value)
      out.set(path, { parts: [...r.parts, ...r.texParts.map((p) => `\\p:${p}`)], cards: r.cards })
    } else {
      out.set(path, { parts: texPartIds(value).map((p) => `\\p:${p}`), cards: [] })
    }
  })
  return out
}

/**
 * Compare two translations of one lesson. They must share every id (parts, cards, sections and
 * their items), each part's role and color, every link target per field, and the structure of
 * every widget. Prose, labels and units may differ. Paths point into `other`.
 */
export const compareTranslations = (base: LessonSpec, other: LessonSpec): ReadonlyArray<Issue> => {
  const issues = new Issues()
  const tag = `${base.lang} vs ${other.lang}`
  if (base.kind !== other.kind) issues.add("kind", "parity", `${tag}: kind ${base.kind} vs ${other.kind}`)

  const partIds = [Object.keys(base.parts), Object.keys(other.parts)] as const
  if (!sameSet(...partIds))
    issues.add("parts", "parity", `${tag}: part ids ${show(partIds[0])} vs ${show(partIds[1])}`)
  for (const [id, part] of Object.entries(base.parts)) {
    const o = other.parts[id]
    if (o !== undefined && (o.role !== part.role || o.color !== part.color)) {
      issues.add(
        `parts.${id}`,
        "parity",
        `${tag}: part "${id}" is ${part.role}/${part.color} vs ${o.role}/${o.color}`,
      )
    }
  }

  const cardIds = [Object.keys(base.cards), Object.keys(other.cards)] as const
  if (!sameSet(...cardIds))
    issues.add("cards", "parity", `${tag}: card ids ${show(cardIds[0])} vs ${show(cardIds[1])}`)
  for (const [id, card] of Object.entries(base.cards)) {
    const o = other.cards[id]
    if (o === undefined) continue
    const a = isConceptCardRef(card) ? `concept ${card.concept}` : `kind ${card.kind}`
    const b = isConceptCardRef(o) ? `concept ${o.concept}` : `kind ${o.kind}`
    if (a !== b) issues.add(`cards.${id}`, "parity", `${tag}: card "${id}" is ${a} vs ${b}`)
  }

  const secIds = [
    base.sections.map((s) => `${s.id}:${s.type}`),
    other.sections.map((s) => `${s.id}:${s.type}`),
  ] as const
  if (!sameList(...secIds)) {
    issues.add("sections", "parity", `${tag}: sections ${show(secIds[0])} vs ${show(secIds[1])}`)
  } else {
    base.sections.forEach((s, i) => {
      const o = other.sections[i]
      if (o === undefined) return
      const a = JSON.stringify(sectionShape(s))
      const b = JSON.stringify(sectionShape(o))
      if (a !== b)
        issues.add(`sections[${i}]`, "parity", `${tag}: section "${s.id}" differs in structure: ${a} vs ${b}`)
    })
  }

  // Same link targets in every field. Only meaningful when the structure matches.
  if (issues.list.length === 0) {
    const a = fieldRefs(base)
    const b = fieldRefs(other)
    for (const [path, refs] of a) {
      const o = b.get(path)
      if (o === undefined) {
        issues.add(path, "parity", `${tag}: field is missing`)
        continue
      }
      if (!sameSet(refs.parts, o.parts)) {
        issues.add(path, "parity", `${tag}: part links ${show(refs.parts)} vs ${show(o.parts)}`)
      }
      if (!sameSet(refs.cards, o.cards)) {
        issues.add(path, "parity", `${tag}: card links ${show(refs.cards)} vs ${show(o.cards)}`)
      }
    }
    for (const path of b.keys()) if (!a.has(path)) issues.add(path, "parity", `${tag}: field is extra`)
  }

  return issues.list
}

// ── Concepts

/** Checks one concept on its own: no part or card links (a concept stands alone), clean needs. */
export const validateConcept = (concept: ConceptSpec): ReadonlyArray<Issue> => {
  const issues = new Issues()
  visitCard(concept.card, "card", (path, value) => {
    const refs = richRefs(value)
    for (const id of [...refs.parts, ...refs.texParts]) {
      issues.add(path, "not_allowed", `a shared concept cannot link to part "${id}"; lessons own parts`)
    }
    for (const id of refs.cards) {
      issues.add(
        path,
        "not_allowed",
        `a shared concept cannot link to card "${id}"; list it in needs instead`,
      )
    }
  })
  concept.needs.forEach((need, i) => {
    if (need === concept.slug) issues.add(`needs[${i}]`, "cycle", `"${concept.slug}" needs itself`)
  })
  for (const [slug, i] of duplicates(concept.needs)) {
    issues.add(`needs[${i}]`, "duplicate_id", `"${slug}" is listed twice`)
  }
  return issues.list
}

/**
 * Checks a set of concepts together (one language, or all languages merged by slug): every
 * `needs` resolves (in the set, or through `exists` for concepts stored elsewhere) and the
 * prerequisite graph has no cycle. Paths are `<slug>.needs[i]`.
 */
export const validateConceptGraph = (
  concepts: Iterable<ConceptSpec>,
  exists: (slug: string) => boolean = () => false,
): ReadonlyArray<Issue> => {
  const issues = new Issues()
  const edges = new Map<string, ReadonlyArray<string>>()
  for (const c of concepts) edges.set(c.slug, [...(edges.get(c.slug) ?? []), ...c.needs])
  for (const [slug, needs] of edges) {
    needs.forEach((need, i) => {
      if (!edges.has(need) && !exists(need)) {
        issues.add(
          `${slug}.needs[${i}]`,
          "unknown_concept",
          `"${slug}" needs "${need}", which does not exist`,
        )
      }
    })
  }
  for (const cycle of findCycles(edges)) {
    issues.add(`${cycle[0]}.needs`, "cycle", `concept cycle: ${cycle.join(" → ")}`)
  }
  return issues.list
}

/** Compare two translations of one concept: same slug, card kind and needs. */
export const compareConceptTranslations = (base: ConceptSpec, other: ConceptSpec): ReadonlyArray<Issue> => {
  const issues = new Issues()
  const tag = `${base.lang} vs ${other.lang}`
  if (base.slug !== other.slug) issues.add("slug", "parity", `${tag}: slug ${base.slug} vs ${other.slug}`)
  if (base.card.kind !== other.card.kind) {
    issues.add("card.kind", "parity", `${tag}: card kind ${base.card.kind} vs ${other.card.kind}`)
  }
  if (!sameSet(base.needs, other.needs)) {
    issues.add("needs", "parity", `${tag}: needs ${show(base.needs)} vs ${show(other.needs)}`)
  }
  return issues.list
}
