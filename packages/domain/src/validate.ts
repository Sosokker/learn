// One validator for references inside a lesson and between translations. The schema checks the
// shape; this checks that every link points at something: `[part:]`, `{card|}`, `\p{}{}`, step
// `uses`, proof `deps`, graph `needs`, widget `part`s, expression variables, and shared concepts.
// The server runs it on publish, pi runs it before `/publish`, and a test runs it over `content/**`.

import { compileExpr, ExprError } from "./expr.ts"
import type { CardEntry, ConceptSpec, LessonSpec, Param, Section, Widget } from "./lesson.ts"
import { maxLessonBytes } from "./lesson.ts"
import { richRefs, texPartRefs } from "./rich.ts"

export interface Issue {
  readonly path: string
  readonly message: string
}

export const isConceptRef = (c: CardEntry): c is { readonly concept: string } => "concept" in c

// "physics.average-speed@2" → { slug: "physics.average-speed", version: 2 }
export function parseConceptRef(ref: string): { slug: string; version: number | undefined } {
  const at = ref.indexOf("@")
  return at < 0
    ? { slug: ref, version: undefined }
    : { slug: ref.slice(0, at), version: Number(ref.slice(at + 1)) }
}

type Visit = (path: string, value: string, kind: "rich" | "tex") => void

function visitWidget(w: Widget, path: string, visit: Visit) {
  const opt = (p: string, v: string | undefined) => {
    if (v !== undefined) visit(p, v, "rich")
  }
  switch (w.kind) {
    case "plot":
      opt(`${path}.x.label`, w.x.label)
      opt(`${path}.y.label`, w.y.label)
      for (const [i, p] of w.params.entries()) visit(`${path}.params[${i}].label`, p.label, "rich")
      for (const [i, c] of w.curves.entries()) opt(`${path}.curves[${i}].label`, c.label)
      for (const [i, p] of (w.points ?? []).entries()) opt(`${path}.points[${i}].label`, p.label)
      for (const [i, r] of (w.readouts ?? []).entries())
        visit(`${path}.readouts[${i}].label`, r.label, "rich")
      break
    case "table":
      for (const [i, h] of w.head.entries()) visit(`${path}.head[${i}]`, h, "rich")
      for (const [i, r] of w.rows.entries())
        for (const [j, c] of r.entries()) visit(`${path}.rows[${i}][${j}]`, c, "rich")
      break
    case "flow":
      for (const [i, n] of w.nodes.entries()) visit(`${path}.nodes[${i}].label`, n.label, "rich")
      for (const [i, e] of w.edges.entries()) opt(`${path}.edges[${i}].label`, e.label)
      break
    case "incline":
      for (const [i, p] of w.params.entries()) visit(`${path}.params[${i}].label`, p.label, "rich")
      break
    case "trace":
      for (const [i, s] of w.steps.entries()) visit(`${path}.steps[${i}].note`, s.note, "rich")
      break
  }
}

function visitSection(s: Section, path: string, visit: Visit) {
  const opt = (p: string, v: string | undefined, kind: "rich" | "tex" = "rich") => {
    if (v !== undefined) visit(p, v, kind)
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
        for (const k of ["title", "path", "why", "whyNot"] as const)
          visit(`${path}.routes[${i}].${k}`, r[k], "rich")
      })
      opt(`${path}.notUsed`, s.notUsed)
      break
    case "chain":
      s.steps.forEach((st, i) => {
        const p = `${path}.steps[${i}]`
        visit(`${p}.move`, st.move, "rich")
        opt(`${p}.formula`, st.formula, "tex")
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
      for (const [i, it] of s.items.entries()) visit(`${path}.items[${i}]`, it, "rich")
      break
    case "story":
      for (const [i, e] of s.events.entries()) visit(`${path}.events[${i}].text`, e.text, "rich")
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
        for (const [j, o] of q.options.entries()) visit(`${p}.options[${j}]`, o, "rich")
        visit(`${p}.why`, q.why, "rich")
      })
      break
  }
}

// Calls `visit` for every Rich and TeX string in a lesson, with a JSON-ish path for error messages.
export function visitLessonText(spec: LessonSpec, visit: Visit) {
  visit("title", spec.title, "rich")
  visit("summary", spec.summary, "rich")
  for (const [id, p] of Object.entries(spec.parts)) {
    for (const k of ["label", "body", "example", "analogy"] as const) {
      const v = p[k]
      if (v !== undefined) visit(`parts.${id}.${k}`, v, "rich")
    }
  }
  for (const [id, c] of Object.entries(spec.cards)) {
    if (isConceptRef(c)) continue
    for (const k of ["title", "body", "says", "from", "useWhen", "units", "example", "analogy"] as const) {
      const v = c[k]
      if (v !== undefined) visit(`cards.${id}.${k}`, v, "rich")
    }
  }
  for (const [i, s] of spec.sections.entries()) visitSection(s, `sections[${i}](${s.id})`, visit)
}

// Ids of the items inside a section: the second half of an `@slug/section.item` reference.
export function sectionItemIds(s: Section): Array<string> {
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

// UTF-8 byte length without TextEncoder, which the domain's `es2023` lib doesn't declare.
export function utf8Length(s: string): number {
  let n = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) as number
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
  }
  return n
}

const idPattern = /^[a-z][a-z0-9_]{0,31}$/

function findCycle(nodes: ReadonlyMap<string, ReadonlyArray<string>>): Array<string> | undefined {
  const state = new Map<string, 1 | 2>()
  const stack: Array<string> = []
  const dfs = (n: string): Array<string> | undefined => {
    state.set(n, 1)
    stack.push(n)
    for (const m of nodes.get(n) ?? []) {
      if (!nodes.has(m)) continue
      if (state.get(m) === 1) return [...stack.slice(stack.indexOf(m)), m]
      if (state.get(m) === undefined) {
        const c = dfs(m)
        if (c) return c
      }
    }
    stack.pop()
    state.set(n, 2)
    return undefined
  }
  for (const n of nodes.keys()) {
    if (state.get(n) === undefined) {
      const c = dfs(n)
      if (c) return c
    }
  }
  return undefined
}

export interface LessonContext {
  // Shared concepts the lesson may point at. Omit to skip that check (e.g. offline in pi without
  // a concept index); the server always passes it.
  readonly concepts?: ReadonlySet<string>
}

export function validateLesson(spec: LessonSpec, ctx: LessonContext = {}): Array<Issue> {
  const issues: Array<Issue> = []
  const add = (path: string, message: string) => issues.push({ path, message })
  const parts = new Set(Object.keys(spec.parts))
  const cards = new Set(Object.keys(spec.cards))

  for (const id of parts) if (!idPattern.test(id)) add(`parts.${id}`, `part id "${id}" is not a valid id`)
  for (const id of cards) if (!idPattern.test(id)) add(`cards.${id}`, `card id "${id}" is not a valid id`)
  const part = (path: string, id: string) => {
    if (!parts.has(id)) add(path, `unknown part "${id}"`)
  }
  const card = (path: string, id: string) => {
    if (!cards.has(id)) add(path, `unknown card "${id}"`)
  }

  for (const [id, c] of Object.entries(spec.cards)) {
    if (!isConceptRef(c)) continue
    const { slug } = parseConceptRef(c.concept)
    if (ctx.concepts !== undefined && !ctx.concepts.has(slug)) add(`cards.${id}`, `unknown concept "${slug}"`)
  }

  visitLessonText(spec, (path, value, kind) => {
    if (kind === "tex") {
      for (const p of texPartRefs(value)) part(path, p)
      return
    }
    const refs = richRefs(value)
    for (const p of refs.parts) part(path, p)
    for (const c of refs.cards) card(path, c)
  })

  const sectionIds = new Set<string>()
  spec.sections.forEach((s, i) => {
    const path = `sections[${i}](${s.id})`
    if (sectionIds.has(s.id)) add(path, `duplicate section id "${s.id}"`)
    sectionIds.add(s.id)
    const items = sectionItemIds(s)
    const seen = new Set<string>()
    for (const it of items) {
      if (seen.has(it)) add(path, `duplicate item id "${it}"`)
      seen.add(it)
    }

    switch (s.type) {
      case "concept":
        for (const [j, c] of s.prerequisites.entries()) card(`${path}.prerequisites[${j}]`, c)
        break
      case "plan":
        if (!s.routes.some((r) => r.picked)) add(path, "no route is picked")
        break
      case "chain":
        for (const [j, st] of s.steps.entries())
          for (const [k, u] of st.uses.entries()) part(`${path}.steps[${j}].uses[${k}]`, u)
        break
      case "proof": {
        const earlier = new Set<string>()
        s.lines.forEach((l, j) => {
          for (const d of l.deps) {
            if (!seen.has(d)) add(`${path}.lines[${j}].deps`, `unknown line "${d}"`)
            else if (!earlier.has(d))
              add(`${path}.lines[${j}].deps`, `line "${d}" comes later, a proof can only use earlier lines`)
          }
          earlier.add(l.id)
        })
        break
      }
      case "graph": {
        s.nodes.forEach((n, j) => {
          const p = `${path}.nodes[${j}]`
          for (const m of n.needs) if (!seen.has(m)) add(`${p}.needs`, `unknown node "${m}"`)
          if (n.card !== undefined) card(`${p}.card`, n.card)
          if (n.part !== undefined) part(`${p}.part`, n.part)
        })
        const cycle = findCycle(new Map(s.nodes.map((n) => [n.id, n.needs])))
        if (cycle) add(path, `graph has a cycle: ${cycle.join(" → ")}`)
        break
      }
      case "recall":
        s.questions.forEach((q, j) => {
          if (q.options.length < 2) add(`${path}.questions[${j}]`, "a question needs at least 2 options")
          if (q.answer < 0 || q.answer >= q.options.length)
            add(`${path}.questions[${j}].answer`, `answer ${q.answer} is not an option index`)
        })
        break
      case "visual":
        validateWidget(s.widget, `${path}.widget`, part, card, add)
        break
    }
  })

  const bytes = utf8Length(JSON.stringify(spec))
  if (bytes > maxLessonBytes) add("", `lesson is ${bytes} bytes, the limit is ${maxLessonBytes}`)
  return issues
}

function validateWidget(
  w: Widget,
  path: string,
  part: (path: string, id: string) => void,
  card: (path: string, id: string) => void,
  add: (path: string, message: string) => void,
) {
  const params = (list: ReadonlyArray<Param>) => {
    const ids = new Set<string>()
    list.forEach((p, i) => {
      const pp = `${path}.params[${i}]`
      if (ids.has(p.id)) add(pp, `duplicate param "${p.id}"`)
      ids.add(p.id)
      if (!(p.min < p.max)) add(pp, "min must be less than max")
      if (!(p.step > 0)) add(pp, "step must be positive")
      if (p.value < p.min || p.value > p.max) add(pp, "value is outside min..max")
      if (p.part !== undefined) part(`${pp}.part`, p.part)
    })
    return ids
  }
  const expr = (p: string, src: string, allowed: ReadonlySet<string>) => {
    try {
      for (const v of compileExpr(src).vars)
        if (!allowed.has(v)) add(p, `unknown variable "${v}" in "${src}"`)
    } catch (e) {
      if (e instanceof ExprError) add(p, `bad expression "${src}": ${e.message} at ${e.at}`)
      else throw e
    }
  }

  switch (w.kind) {
    case "plot": {
      const ids = params(w.params)
      if (!(w.x.min < w.x.max)) add(`${path}.x`, "min must be less than max")
      if (!(w.y.min < w.y.max)) add(`${path}.y`, "min must be less than max")
      const withX = new Set([...ids, "x"])
      w.curves.forEach((c, i) => {
        expr(`${path}.curves[${i}].expr`, c.expr, withX)
        if (c.part !== undefined) part(`${path}.curves[${i}].part`, c.part)
      })
      w.points?.forEach((p, i) => {
        expr(`${path}.points[${i}].x`, p.x, ids)
        expr(`${path}.points[${i}].y`, p.y, ids)
        if (p.part !== undefined) part(`${path}.points[${i}].part`, p.part)
      })
      w.readouts?.forEach((r, i) => {
        expr(`${path}.readouts[${i}].expr`, r.expr, ids)
        if (r.part !== undefined) part(`${path}.readouts[${i}].part`, r.part)
      })
      break
    }
    case "table": {
      const cols = w.head.length
      w.rows.forEach((r, i) => {
        if (r.length !== cols) add(`${path}.rows[${i}]`, `row has ${r.length} cells, the head has ${cols}`)
      })
      break
    }
    case "flow": {
      const ids = new Set(w.nodes.map((n) => n.id))
      w.nodes.forEach((n, i) => {
        if (n.part !== undefined) part(`${path}.nodes[${i}].part`, n.part)
        if (n.card !== undefined) card(`${path}.nodes[${i}].card`, n.card)
      })
      w.edges.forEach((e, i) => {
        if (!ids.has(e.from)) add(`${path}.edges[${i}].from`, `unknown node "${e.from}"`)
        if (!ids.has(e.to)) add(`${path}.edges[${i}].to`, `unknown node "${e.to}"`)
        if (e.part !== undefined) part(`${path}.edges[${i}].part`, e.part)
      })
      break
    }
    case "incline": {
      const ids = params(w.params)
      for (const need of ["angle"])
        if (!ids.has(need)) add(`${path}.params`, `incline needs a "${need}" param`)
      for (const [k, v] of Object.entries(w.parts)) part(`${path}.parts.${k}`, v)
      break
    }
    case "trace": {
      const lines = w.code.split("\n").length
      w.steps.forEach((s, i) => {
        if (s.line < 1 || s.line > lines)
          add(`${path}.steps[${i}].line`, `line ${s.line} is outside the code (1..${lines})`)
      })
      break
    }
  }
}

// ── Translations. A lesson and its translation must share every id, so `@ref`s, comments and
// progress mean the same thing in both languages.
function lessonIdSkeleton(spec: LessonSpec): Map<string, string> {
  const m = new Map<string, string>()
  m.set("kind", spec.kind)
  for (const id of Object.keys(spec.parts)) m.set(`part:${id}`, spec.parts[id]?.color ?? "")
  for (const [id, c] of Object.entries(spec.cards))
    m.set(`card:${id}`, isConceptRef(c) ? `concept:${c.concept}` : c.kind)
  spec.sections.forEach((s, i) => {
    m.set(`section[${i}]`, `${s.id}:${s.type}`)
    for (const it of sectionItemIds(s)) m.set(`item:${s.id}.${it}`, "")
    if (s.type === "chain")
      for (const st of s.steps) m.set(`uses:${s.id}.${st.id}`, [...st.uses].sort().join(","))
    if (s.type === "proof")
      for (const l of s.lines) m.set(`deps:${s.id}.${l.id}`, [...l.deps].sort().join(","))
    if (s.type === "graph")
      for (const n of s.nodes) m.set(`needs:${s.id}.${n.id}`, [...n.needs].sort().join(","))
    if (s.type === "recall") for (const q of s.questions) m.set(`answer:${s.id}.${q.id}`, String(q.answer))
  })
  return m
}

export function translationIssues(a: LessonSpec, b: LessonSpec): Array<Issue> {
  const issues: Array<Issue> = []
  if (a.lang === b.lang) issues.push({ path: "lang", message: `both versions are "${a.lang}"` })
  const ma = lessonIdSkeleton(a)
  const mb = lessonIdSkeleton(b)
  for (const [k, v] of ma) {
    if (!mb.has(k)) issues.push({ path: k, message: `missing in ${b.lang}` })
    else if (mb.get(k) !== v)
      issues.push({ path: k, message: `${a.lang} has "${v}", ${b.lang} has "${mb.get(k)}"` })
  }
  for (const k of mb.keys()) if (!ma.has(k)) issues.push({ path: k, message: `missing in ${a.lang}` })
  return issues
}

// ── Concepts. A concept card has no local parts or cards to point at: its children are `needs`.
export function validateConcept(c: ConceptSpec, known?: ReadonlySet<string>): Array<Issue> {
  const issues: Array<Issue> = []
  for (const k of ["title", "body", "says", "from", "useWhen", "units", "example", "analogy"] as const) {
    const v = c.card[k]
    if (v === undefined) continue
    const refs = richRefs(v)
    if (refs.parts.length > 0 || refs.cards.length > 0)
      issues.push({ path: `card.${k}`, message: "a concept card cannot link parts or cards; use needs" })
  }
  if (c.needs.includes(c.slug)) issues.push({ path: "needs", message: "a concept cannot need itself" })
  if (known !== undefined)
    for (const n of c.needs)
      if (!known.has(n)) issues.push({ path: "needs", message: `unknown concept "${n}"` })
  return issues
}

// Checks a set of concepts together: all translations agree on `needs`, and `needs` has no cycle.
export function conceptSetIssues(all: ReadonlyArray<ConceptSpec>): Array<Issue> {
  const issues: Array<Issue> = []
  const bySlug = new Map<string, Array<ConceptSpec>>()
  for (const c of all) bySlug.set(c.slug, [...(bySlug.get(c.slug) ?? []), c])
  const known = new Set(bySlug.keys())
  for (const c of all)
    for (const i of validateConcept(c, known)) issues.push({ ...i, path: `${c.slug}/${c.lang}.${i.path}` })
  for (const [slug, list] of bySlug) {
    const needs = new Set(list.map((c) => [...c.needs].sort().join(",")))
    if (needs.size > 1) issues.push({ path: slug, message: "translations disagree on needs" })
    const kinds = new Set(list.map((c) => c.card.kind))
    if (kinds.size > 1) issues.push({ path: slug, message: "translations disagree on card kind" })
    const langs = list.map((c) => c.lang)
    if (new Set(langs).size !== langs.length) issues.push({ path: slug, message: "duplicate language" })
  }
  const cycle = findCycle(new Map([...bySlug].map(([s, l]) => [s, l[0]?.needs ?? []])))
  if (cycle) issues.push({ path: "needs", message: `concept graph has a cycle: ${cycle.join(" → ")}` })
  return issues
}
