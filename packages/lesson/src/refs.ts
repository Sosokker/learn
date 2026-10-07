// `@ref`s and the "copy prompt for pi" text (design §6): the learner's question plus the exact
// pieces they pointed at, as clean TeX (no `\p` markers, no markup).

import { type Card, parseRich, type RichNode } from "@app/domain"
import type { Translate } from "./messages.ts"
import { type LessonModel, type Target, titleOf } from "./model.ts"
import { stripTexParts } from "./tex.ts"

/** `@<slug>/<section>[.<item>]`, the stable reference format (same in every language). */
export const buildRef = (slug: string, section: string, item?: string): string =>
  item === undefined ? `@${slug}/${section}` : `@${slug}/${section}.${item}`

/**
 * The name of a target in the ask bar and the prompt. Sections and items get a real `@ref`;
 * parts and cards are not addressable by `@ref`, so they are named `part:<id>` / `card:<id>`.
 */
export const refName = (model: LessonModel, t: Target): string => {
  switch (t.kind) {
    case "item":
      return buildRef(model.slug, t.section, t.item)
    case "section":
      return buildRef(model.slug, t.section)
    case "part":
      return `part:${t.id}`
    case "card":
      return `card:${t.id}`
    case "concept":
      return `concept:${t.slug}`
  }
}

/** True when the target has a real `@ref` (a section or an item). */
export const hasRef = (t: Target): boolean => t.kind === "item" || t.kind === "section"

/** Rich markup → clean text with math as `$…$` / `$$…$$` TeX. */
export const richToTex = (src: string): string => {
  const walk = (nodes: ReadonlyArray<RichNode>): string =>
    nodes
      .map((n) => {
        switch (n.type) {
          case "text":
            return n.text
          case "code":
            return `\`${n.text}\``
          case "math":
            return n.display ? `$$${stripTexParts(n.tex)}$$` : `$${stripTexParts(n.tex)}$`
          default:
            return walk(n.children)
        }
      })
      .join("")
  return walk(parseRich(src)).trim()
}

const line = (label: string, value: string | undefined): ReadonlyArray<string> =>
  value === undefined || value.trim() === "" ? [] : [`${label}: ${richToTex(value)}`]

const cardLines = (card: Card, t: Translate): ReadonlyArray<string> => [
  richToTex(card.body),
  ...line(t("field.says"), card.says),
  ...line(t("field.from"), card.from),
  ...line(t("field.useWhen"), card.useWhen),
  ...line(t("field.units"), card.units),
  ...line(t("field.example"), card.example),
  ...line(t("field.analogy"), card.analogy),
]

const partSummary = (model: LessonModel, id: string): string => {
  const p = model.part(id)
  return p === undefined ? id : `${richToTex(p.label)} (${p.meaning})`
}

/** The body of one referenced piece: title line, then its content, as clean TeX. */
export const targetTex = (model: LessonModel, target: Target, t: Translate): string => {
  const title = richToTex(titleOf(model, target))
  const body: Array<string> = []
  switch (target.kind) {
    case "part": {
      const p = model.part(target.id)
      if (p !== undefined) {
        body.push(`${t(`role.${p.role}`)}: ${p.meaning}`)
        if (p.body !== undefined) body.push(richToTex(p.body))
        body.push(...line(t("field.example"), p.example), ...line(t("field.analogy"), p.analogy))
      }
      break
    }
    case "card": {
      const r = model.card(target.id)
      if (r?.card !== undefined) body.push(...cardLines(r.card, t))
      break
    }
    case "concept": {
      const c = model.concept(target.slug)
      if (c !== undefined) body.push(...cardLines(c.card, t))
      break
    }
    case "section": {
      const s = model.sections.get(target.section)
      if (s !== undefined) {
        switch (s.type) {
          case "text":
          case "problem":
            body.push(richToTex(s.body))
            break
          case "concept":
            body.push(...line(t("field.concept"), s.concept), ...line(t("field.field"), s.field))
            break
          case "check":
            body.push(...s.items.map((i) => `- ${richToTex(i)}`))
            break
          case "proof":
            body.push(...line(t("field.goal"), s.goal))
            break
          default:
            break
        }
        for (const it of model.sectionItems.get(s.id) ?? []) {
          const sub: Target = { kind: "item", section: s.id, item: it.itemId }
          body.push(`- ${refName(model, sub)}: ${richToTex(titleOf(model, sub))}`)
        }
      }
      break
    }
    case "item": {
      const it = model.item(target.section, target.item)
      if (it === undefined) break
      switch (it.type) {
        case "chunks":
          body.push(`${t(`role.${it.row.role}`)}: ${richToTex(it.row.note)}`)
          break
        case "plan":
          body.push(
            richToTex(it.route.path),
            ...line(t("field.why"), it.route.why),
            ...line(t("field.whyNot"), it.route.whyNot),
            it.route.picked ? t("plan.picked") : t("plan.notPicked"),
          )
          break
        case "chain":
          body.push(
            `${t("chain.step", { n: it.index + 1 })}`,
            ...(it.step.formula === undefined ? [] : [`$$${stripTexParts(it.step.formula)}$$`]),
            ...line(t("field.why"), it.step.why),
            ...line(t("field.whyNot"), it.step.whyNot),
          )
          if (it.step.uses.length > 0)
            body.push(`uses: ${it.step.uses.map((u) => partSummary(model, u)).join("; ")}`)
          break
        case "proof": {
          const lines = it.section.lines
          body.push(
            t("inspector.lineOf", { n: it.index + 1, total: lines.length }),
            ...line(t("field.why"), it.line.why),
            ...line(t("field.intuition"), it.line.intuition),
            ...line(t("field.whyNot"), it.line.whyNot),
          )
          const deps = it.line.deps.map((d) => lines.findIndex((l) => l.id === d) + 1).filter((n) => n > 0)
          body.push(
            deps.length === 0
              ? t("inspector.usesNone")
              : t("inspector.usesLines", { lines: deps.join(", ") }),
          )
          break
        }
        case "graph": {
          const labels = it.node.needs.map((n) => it.section.nodes.find((x) => x.id === n)?.label ?? n)
          body.push(
            labels.length === 0
              ? t("inspector.dependsNone")
              : t("inspector.dependsOn", { list: labels.join(", ") }),
          )
          break
        }
        case "story":
          break
        case "units":
          body.push(richToTex(it.unit.milestone))
          break
        case "recall":
          body.push(
            ...it.question.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${richToTex(o)}`),
            ...line(t("field.why"), it.question.why),
          )
          break
        case "flow":
          break
      }
      break
    }
  }
  return [title, ...body.filter((s) => s.trim() !== "")].join("\n")
}

// A fence of backticks longer than any backtick run inside `body`, so lesson text can never close
// its own block and continue as if it were the learner (or the system) talking.
const fenced = (label: string, body: string): string => {
  const longest = Math.max(0, ...Array.from(body.matchAll(/`+/g), (m) => m[0].length))
  const fence = "`".repeat(Math.max(3, longest + 1))
  // The label goes in the info string; keep it to characters that cannot break the fence line.
  const info = label.replace(/[^A-Za-z0-9@/._:-]/g, "_")
  return `${fence}text ${info}\n${body}\n${fence}`
}

/**
 * The full prompt for pi: the learner's question, a note that what follows is quoted lesson text
 * (written by whoever published the lesson, so untrusted), then the lesson title and each
 * referenced piece in its own fenced block.
 */
export const buildPrompt = (
  model: LessonModel,
  question: string,
  refs: ReadonlyArray<Target>,
  t: Translate,
): string => {
  const q = question.trim() === "" ? t("ask.noQuestion") : question.trim()
  if (refs.length === 0) return `${q}\n\n${t("prompt.noRefs")}`
  const blocks = [
    fenced("lesson-title", model.spec.title),
    ...refs.map((r) => fenced(refName(model, r), targetTex(model, r, t))),
  ]
  return [q, t("prompt.untrusted"), ...blocks].join("\n\n")
}

/** Copy text to the clipboard: the async Clipboard API, else a hidden textarea + execCommand. */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Permission denied or insecure context: fall through to the old way.
  }
  if (typeof document === "undefined") return false
  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.opacity = "0"
  area.style.pointerEvents = "none"
  document.body.append(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand("copy")
  } catch {
    ok = false
  }
  area.remove()
  return ok
}
