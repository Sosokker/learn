import {
  type LessonSpec,
  type PinnedConcept,
  parseRich,
  type RichNode,
  richToPlain,
  type Section,
  type Widget,
} from "@app/domain"
import { resolveTarget, type Target } from "./cards.ts"
import { type Strings, strings } from "./strings.ts"

// `@ref`s: every section has `data-ref="sectionId"`, every item `data-ref="sectionId.itemId"`, and
// the inspector adds `cards.<id>`, `parts.<id>` and `concepts.<slug>`. A chip reads `@slug/key`.

export const refChip = (slug: string, key: string) => `@${slug}/${key}`

const texPartMark = /\\p\{[a-z][a-z0-9_]{0,31}\}/g
const stripTex = (tex: string) => tex.replace(texPartMark, "")

// Plain text of Rich for a prompt. Unlike richToPlain it keeps math as `$…$`, so pi sees the formula.
export function richToPrompt(src: string): string {
  const walk = (nodes: ReadonlyArray<RichNode>): string =>
    nodes
      .map((n) => {
        switch (n.t) {
          case "text":
            return n.v
          case "code":
            return `\`${n.v}\``
          case "br":
            return "\n"
          case "math":
            return n.display ? `$$${stripTex(n.tex)}$$` : `$${stripTex(n.tex)}$`
          default:
            return walk(n.c)
        }
      })
      .join("")
  return parseRich(src).map(walk).join("\n\n")
}

const texToPrompt = (tex: string) => `$${stripTex(tex)}$`

interface Block {
  readonly heading: string
  readonly lines: Array<string>
}

const field = (label: string, v: string | undefined): Array<string> =>
  v === undefined || v === "" ? [] : [`${label}: ${richToPrompt(v)}`]

function partList(spec: LessonSpec, ids: ReadonlyArray<string>): string {
  return ids
    .map((id) => {
      const p = Object.hasOwn(spec.parts, id) ? spec.parts[id] : undefined
      return p ? `${richToPrompt(p.label)} (${p.meaning})` : id
    })
    .join("; ")
}

function widgetLines(w: Widget, s: Strings): Array<string> {
  switch (w.kind) {
    case "plot":
      return [
        ...w.params.map((p) => `${richToPlain(p.label)}: ${p.min}..${p.max}, start ${p.value}`),
        ...w.curves.map((c) => `curve${c.label ? ` "${richToPlain(c.label)}"` : ""}: y = ${c.expr}`),
        ...(w.readouts ?? []).map((r) => `${richToPrompt(r.label)} = ${r.expr}${r.unit ? ` ${r.unit}` : ""}`),
      ]
    case "table":
      return [w.head, ...w.rows].map((r) => `| ${r.map(richToPrompt).join(" | ")} |`)
    case "flow":
      return w.edges.map(
        (e) => `${e.from} → ${e.to}${e.label === undefined ? "" : ` (${richToPrompt(e.label)})`}`,
      )
    case "incline":
      return [
        ...w.params.map((p) => `${richToPlain(p.label)}: ${p.min}..${p.max}, start ${p.value}`),
        `forces: ${w.forces.map((f) => s.forces[f] ?? f).join(", ")}`,
      ]
    case "trace":
      return [`\`\`\`${w.lang}\n${w.code}\n\`\`\``]
  }
}

// Text of one section, or of one item inside it.
function sectionBlock(sec: Section, itemId: string | undefined, spec: LessonSpec, s: Strings): Block | null {
  const title = sec.title ?? s.sectionTypes[sec.type] ?? sec.type
  const pick = <T extends { readonly id: string }>(items: ReadonlyArray<T>) =>
    itemId === undefined
      ? items.map((it, i) => ({ it, i }))
      : items.flatMap((it, i) => (it.id === itemId ? [{ it, i }] : []))
  const head = (sub?: string) => (sub === undefined ? title : `${title} › ${sub}`)
  switch (sec.type) {
    case "text":
    case "problem":
      return itemId === undefined ? { heading: head(), lines: [richToPrompt(sec.body)] } : null
    case "chunks": {
      const rows = pick(sec.rows)
      if (rows.length === 0) return null
      return {
        heading: head(itemId === undefined ? undefined : richToPlain(rows[0]?.it.text ?? "")),
        lines: rows.map(
          ({ it }) => `${richToPrompt(it.text)} [${s.roles[it.role]}]: ${richToPrompt(it.note)}`,
        ),
      }
    }
    case "concept":
      return itemId === undefined
        ? { heading: head(), lines: [...field(s.concept, sec.concept), ...field(s.field, sec.field)] }
        : null
    case "plan": {
      const routes = pick(sec.routes)
      if (routes.length === 0) return null
      const lines = routes.flatMap(({ it }) => [
        `${richToPrompt(it.title)} (${it.picked ? s.picked : s.notPicked}): ${richToPrompt(it.path)}`,
        ...field(s.why, it.why),
        ...field(s.whyNot, it.whyNot),
      ])
      if (itemId === undefined) lines.push(...field(s.notUsed, sec.notUsed))
      return {
        heading: head(itemId === undefined ? undefined : richToPlain(routes[0]?.it.title ?? "")),
        lines,
      }
    }
    case "chain": {
      const steps = pick(sec.steps)
      if (steps.length === 0) return null
      const lines = steps.flatMap(({ it, i }) => [
        ...(itemId === undefined ? [`${s.step} ${i + 1}:`] : []),
        `${s.move}: ${richToPrompt(it.move)}`,
        ...(it.formula === undefined ? [] : [`${s.formula}: ${texToPrompt(it.formula)}`]),
        ...field(s.why, it.why),
        ...field(s.whyNot, it.whyNot),
        ...(it.uses.length === 0 ? [] : [`${s.usesTitle}: ${partList(spec, it.uses)}`]),
      ])
      return {
        heading: head(itemId === undefined ? undefined : `${s.step} ${(steps[0]?.i ?? 0) + 1}`),
        lines,
      }
    }
    case "proof": {
      const lines = pick(sec.lines)
      if (lines.length === 0) return null
      const num = new Map(sec.lines.map((l, i) => [l.id, i + 1]))
      return {
        heading: head(itemId === undefined ? undefined : `${s.line} ${(lines[0]?.i ?? 0) + 1}`),
        lines: [
          ...(itemId === undefined ? field(s.goal, sec.goal) : []),
          ...lines.flatMap(({ it, i }) => [
            `(${i + 1}) ${richToPrompt(it.claim)}`,
            ...field(s.why, it.why),
            ...field(s.intuition, it.intuition),
            ...field(s.whyNot, it.whyNot),
            ...(it.deps.length === 0
              ? []
              : [`${s.usesTitle}: ${it.deps.map((d) => `(${num.get(d) ?? d})`).join(", ")}`]),
          ]),
        ],
      }
    }
    case "graph": {
      const nodes = pick(sec.nodes)
      if (nodes.length === 0) return null
      const label = new Map(sec.nodes.map((n) => [n.id, n.label]))
      return {
        heading: head(itemId === undefined ? undefined : (nodes[0]?.it.label ?? "")),
        lines: nodes.map(
          ({ it }) =>
            `${it.label} [${s.nodeKinds[it.kind] ?? it.kind}]${
              it.needs.length === 0 ? "" : ` ← ${it.needs.map((n) => label.get(n) ?? n).join(", ")}`
            }`,
        ),
      }
    }
    case "visual": {
      const w = sec.widget
      if (itemId !== undefined) {
        if (w.kind !== "flow") return null
        const node = w.nodes.find((n) => n.id === itemId)
        return node ? { heading: head(richToPlain(node.label)), lines: [richToPrompt(node.label)] } : null
      }
      return { heading: head(), lines: widgetLines(w, s) }
    }
    case "check":
      return itemId === undefined
        ? { heading: head(), lines: sec.items.map((it) => `- ${richToPrompt(it)}`) }
        : null
    case "story": {
      const ev = pick(sec.events)
      if (ev.length === 0) return null
      return {
        heading: head(itemId === undefined ? undefined : (ev[0]?.it.year ?? itemId)),
        lines: ev.map(({ it }) => `${it.year === undefined ? "" : `${it.year}: `}${richToPrompt(it.text)}`),
      }
    }
    case "units": {
      const units = pick(sec.units)
      if (units.length === 0) return null
      return {
        heading: head(itemId === undefined ? undefined : richToPlain(units[0]?.it.title ?? "")),
        lines: units.map(({ it, i }) => `${i + 1}. ${richToPrompt(it.title)}: ${richToPrompt(it.milestone)}`),
      }
    }
    case "recall": {
      const qs = pick(sec.questions)
      if (qs.length === 0) return null
      return {
        heading: head(itemId === undefined ? undefined : `${(qs[0]?.i ?? 0) + 1}`),
        lines: qs.flatMap(({ it }) => [
          `${s.question}: ${richToPrompt(it.q)}`,
          ...it.options.map((o, j) => `${String.fromCharCode(65 + j)}. ${richToPrompt(o)}`),
          `${s.answer}: ${String.fromCharCode(65 + it.answer)}`,
          ...field(s.why, it.why),
        ]),
      }
    }
  }
}

function targetBlock(
  t: Target,
  spec: LessonSpec,
  concepts: ReadonlyArray<PinnedConcept>,
  s: Strings,
): Block | null {
  const r = resolveTarget(t, spec, concepts)
  switch (r.k) {
    case "missing":
      return null
    case "part":
      return {
        heading: `${richToPrompt(r.part.label)} [${s.roles[r.part.role]}]`,
        lines: [
          `${s.meaning}: ${r.part.meaning}`,
          ...field(s.body, r.part.body),
          ...field(s.example, r.part.example),
          ...field(s.analogy, r.part.analogy),
        ],
      }
    case "card":
    case "concept": {
      const c = r.card
      return {
        heading: `${richToPrompt(c.title)} [${s.kinds[c.kind]}${r.k === "concept" ? `, ${s.sharedConcept} ${r.slug}` : ""}]`,
        lines: [
          richToPrompt(c.body),
          ...field(s.says, c.says),
          ...field(s.from, c.from),
          ...field(s.useWhen, c.useWhen),
          ...field(s.units, c.units),
          ...field(s.example, c.example),
          ...field(s.analogy, c.analogy),
        ],
      }
    }
  }
}

// The referenced content of one key as clean text, or null when the key points at nothing.
export function refBlock(
  key: string,
  spec: LessonSpec,
  concepts: ReadonlyArray<PinnedConcept>,
  s: Strings,
): Block | null {
  const dot = key.indexOf(".")
  const head = dot < 0 ? key : key.slice(0, dot)
  const rest = dot < 0 ? undefined : key.slice(dot + 1)
  if (rest !== undefined) {
    if (head === "cards") return targetBlock({ k: "card", id: rest }, spec, concepts, s)
    if (head === "parts") return targetBlock({ k: "part", id: rest }, spec, concepts, s)
    if (head === "concepts") return targetBlock({ k: "concept", slug: rest }, spec, concepts, s)
  }
  const sec = spec.sections.find((x) => x.id === head)
  return sec ? sectionBlock(sec, rest, spec, s) : null
}

export interface AskPromptInput {
  readonly question: string
  readonly refs: ReadonlyArray<string>
  readonly spec: LessonSpec
  readonly concepts: ReadonlyArray<PinnedConcept>
  readonly slug: string
  readonly uiLang: "en" | "th"
}

// The question first, then each referenced piece as `[@slug/key] heading` plus its text.
export function buildAskPrompt(input: AskPromptInput): string {
  const s = strings[input.uiLang]
  const q = input.question.trim()
  const out = [q === "" ? s.promptNoQuestion : q]
  const blocks = input.refs.flatMap((key) => {
    const b = refBlock(key, input.spec, input.concepts, s)
    return b === null ? [] : [[`[${refChip(input.slug, key)}] ${b.heading}`, ...b.lines].join("\n")]
  })
  if (blocks.length > 0) out.push(s.promptContext(input.spec.title, input.slug), ...blocks)
  return out.join("\n\n")
}
