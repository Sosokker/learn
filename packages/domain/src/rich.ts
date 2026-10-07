// Rich text: the small markup used in every `Rich` field of a LessonSpec or ConceptSpec.
//
//   [partId:label]     link to a part; the label may contain math, bold, italic, code
//   {cardId|label}     link to a card (drill-down)
//   $tex$  $$tex$$     inline / display math (KaTeX)
//   **bold**  *italic*  `code`
//   \x                 a literal x, for x in  \ $ * ` [ ] { } | _
//   a blank line       a paragraph break (see `parseRichBlocks`)
//
// Inside TeX, `\p{partId}{tex}` marks a hoverable symbol linked to a part (`texPartIds`).
//
// The parser is total: it never throws, and anything it cannot match (an unclosed `$`, a `[` that is
// not `[id:`, a lone `*`) stays as plain text. There is no HTML: the renderer builds every element
// itself from this tree. `@slug/section.item` references appear only inside `code` spans in content,
// so they are plain code here; `parseRef` reads one.

import { idPattern } from "./lesson.ts"

export type RichNode =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "strong"; readonly children: ReadonlyArray<RichNode> }
  | { readonly type: "em"; readonly children: ReadonlyArray<RichNode> }
  | { readonly type: "code"; readonly text: string }
  | { readonly type: "math"; readonly tex: string; readonly display: boolean }
  | { readonly type: "part"; readonly id: string; readonly children: ReadonlyArray<RichNode> }
  | { readonly type: "card"; readonly id: string; readonly children: ReadonlyArray<RichNode> }

/** One paragraph: the inline nodes between blank lines. */
export type RichBlock = ReadonlyArray<RichNode>

const escapable = new Set(["\\", "$", "*", "`", "[", "]", "{", "}", "|", "_"])
const linkId = /[a-z][a-z0-9_]{0,31}/y
// Deep nesting is impossible in valid markup (links do not nest, bold/italic nest once), but a
// hostile string must not blow the stack.
const maxDepth = 8

interface Ctx {
  readonly link: boolean
  readonly strong: boolean
  readonly em: boolean
  readonly depth: number
}

interface Span {
  readonly next: number
}

interface MathSpan extends Span {
  readonly tex: string
  readonly display: boolean
}

// `$…$` or `$$…$$` starting at i (src[i] === "$"). A backslash escapes the next character, so `\$`
// inside math does not close it. Empty math is not math.
const scanMath = (src: string, i: number, end: number): MathSpan | undefined => {
  const display = src[i + 1] === "$"
  const open = display ? 2 : 1
  let j = i + open
  while (j < end) {
    const c = src[j]
    if (c === "\\") {
      j += 2
      continue
    }
    if (c === "$") {
      if (display) {
        if (src[j + 1] === "$" && j + 1 < end) {
          const tex = src.slice(i + 2, j)
          return tex.trim() === "" ? undefined : { tex, display: true, next: j + 2 }
        }
        // A single `$` inside display math: keep scanning.
      } else {
        const tex = src.slice(i + 1, j)
        return tex.trim() === "" ? undefined : { tex, display: false, next: j + 1 }
      }
    }
    j++
  }
  return undefined
}

const scanCode = (src: string, i: number, end: number): (Span & { readonly text: string }) | undefined => {
  const j = src.indexOf("`", i + 1)
  if (j === -1 || j >= end || j === i + 1) return undefined
  return { text: src.slice(i + 1, j), next: j + 1 }
}

// Spans that delimiter searches jump over: escapes, code, math. Returns the index after the span,
// or -1 when nothing starts at i.
const skipSpan = (src: string, i: number, end: number): number => {
  const c = src[i]
  if (c === "\\" && i + 1 < end && escapable.has(src[i + 1] ?? "")) return i + 2
  if (c === "`") return scanCode(src, i, end)?.next ?? -1
  if (c === "$") return scanMath(src, i, end)?.next ?? -1
  return -1
}

// `[id:label]` / `{id|label}` starting at i. The label ends at the matching close bracket; nested
// brackets of the same kind, math and code inside the label are skipped.
const scanLink = (
  src: string,
  i: number,
  end: number,
  open: string,
  sep: string,
  close: string,
):
  | { readonly id: string; readonly labelStart: number; readonly labelEnd: number; readonly next: number }
  | undefined => {
  linkId.lastIndex = i + 1
  const m = linkId.exec(src)
  if (m === null) return undefined
  const sepAt = i + 1 + m[0].length
  if (sepAt >= end || src[sepAt] !== sep) return undefined
  let depth = 0
  let j = sepAt + 1
  while (j < end) {
    const skipped = skipSpan(src, j, end)
    if (skipped !== -1) {
      j = skipped
      continue
    }
    const c = src[j]
    if (c === open) depth++
    else if (c === close) {
      if (depth === 0) return { id: m[0], labelStart: sepAt + 1, labelEnd: j, next: j + 1 }
      depth--
    }
    j++
  }
  return undefined
}

const isSpace = (c: string | undefined) => c === undefined || /\s/u.test(c)

// Closing `**` for bold.
const findStrongClose = (src: string, from: number, end: number): number => {
  let j = from
  while (j < end) {
    const skipped = skipSpan(src, j, end)
    if (skipped !== -1) {
      j = skipped
      continue
    }
    if (src[j] === "*" && src[j + 1] === "*" && j + 1 < end) return j
    j++
  }
  return -1
}

// Closing `*` for italic: a single star after a non-space character. `**` pairs inside are bold.
const findEmClose = (src: string, from: number, end: number): number => {
  let j = from
  while (j < end) {
    const skipped = skipSpan(src, j, end)
    if (skipped !== -1) {
      j = skipped
      continue
    }
    if (src[j] === "*") {
      if (src[j + 1] === "*" && j + 1 < end) {
        const close = findStrongClose(src, j + 2, end)
        j = close === -1 ? j + 2 : close + 2
        continue
      }
      if (!isSpace(src[j - 1])) return j
    }
    j++
  }
  return -1
}

const parseRange = (src: string, start: number, end: number, ctx: Ctx): Array<RichNode> => {
  const out: Array<RichNode> = []
  let buf = ""
  const flush = () => {
    if (buf !== "") {
      const last = out[out.length - 1]
      if (last?.type === "text") out[out.length - 1] = { type: "text", text: last.text + buf }
      else out.push({ type: "text", text: buf })
      buf = ""
    }
  }
  const nested = ctx.depth < maxDepth
  let i = start
  while (i < end) {
    const c = src[i] ?? ""
    const next = src[i + 1]
    if (c === "\\" && i + 1 < end && next !== undefined && escapable.has(next)) {
      buf += next
      i += 2
      continue
    }
    if (c === "`") {
      const code = scanCode(src, i, end)
      if (code !== undefined) {
        flush()
        out.push({ type: "code", text: code.text })
        i = code.next
        continue
      }
    }
    if (c === "$") {
      const math = scanMath(src, i, end)
      if (math !== undefined) {
        flush()
        out.push({ type: "math", tex: math.tex, display: math.display })
        i = math.next
        continue
      }
      // An unclosed `$$` is two literal dollars; do not retry it as `$` + `$…`.
      if (next === "$") {
        buf += "$$"
        i += 2
        continue
      }
    }
    if ((c === "[" || c === "{") && !ctx.link && nested) {
      const link = c === "[" ? scanLink(src, i, end, "[", ":", "]") : scanLink(src, i, end, "{", "|", "}")
      if (link !== undefined) {
        flush()
        const children = parseRange(src, link.labelStart, link.labelEnd, {
          ...ctx,
          link: true,
          depth: ctx.depth + 1,
        })
        out.push({ type: c === "[" ? "part" : "card", id: link.id, children })
        i = link.next
        continue
      }
    }
    if (c === "*" && next === "*" && i + 1 < end) {
      if (!ctx.strong && nested) {
        const close = findStrongClose(src, i + 2, end)
        if (close > i + 2) {
          flush()
          const children = parseRange(src, i + 2, close, { ...ctx, strong: true, depth: ctx.depth + 1 })
          out.push({ type: "strong", children })
          i = close + 2
          continue
        }
      }
      buf += "**"
      i += 2
      continue
    }
    if (c === "*" && !ctx.em && nested && !isSpace(next) && i + 1 < end) {
      const close = findEmClose(src, i + 1, end)
      if (close > i + 1) {
        flush()
        const children = parseRange(src, i + 1, close, { ...ctx, em: true, depth: ctx.depth + 1 })
        out.push({ type: "em", children })
        i = close + 1
        continue
      }
    }
    buf += c
    i++
  }
  flush()
  return out
}

/** Parse Rich markup into inline nodes. Total: never throws; unmatched markup stays text. */
export const parseRich = (src: string): ReadonlyArray<RichNode> =>
  parseRange(src, 0, src.length, { link: false, strong: false, em: false, depth: 0 })

/**
 * Parse Rich markup into paragraphs, split at blank lines in top-level text. Single newlines stay
 * inside text nodes (render them as line breaks or spaces). Empty paragraphs are dropped.
 */
export const parseRichBlocks = (src: string): ReadonlyArray<RichBlock> => {
  const blocks: Array<Array<RichNode>> = [[]]
  for (const node of parseRich(src)) {
    if (node.type !== "text") {
      blocks[blocks.length - 1]?.push(node)
      continue
    }
    const pieces = node.text.split(/\n[ \t]*\n\s*/u)
    pieces.forEach((text, k) => {
      if (k > 0) blocks.push([])
      if (text !== "") blocks[blocks.length - 1]?.push({ type: "text", text })
    })
  }
  return blocks.filter((b) => b.length > 0)
}

const texPartPattern = /\\p(?![a-zA-Z])\s*\{([^{}]*)\}/gu

/** Part ids referenced by `\p{partId}{…}` in a TeX string, in order, without duplicates. */
export const texPartIds = (tex: string): ReadonlyArray<string> => {
  const ids = new Set<string>()
  for (const m of tex.matchAll(texPartPattern)) ids.add((m[1] ?? "").trim())
  return [...ids]
}

export interface RichRefs {
  /** `[part:…]` link targets. */
  readonly parts: ReadonlyArray<string>
  /** `{card|…}` link targets. */
  readonly cards: ReadonlyArray<string>
  /** `\p{part}{…}` targets inside math. */
  readonly texParts: ReadonlyArray<string>
}

/** Every reference in a Rich string, each list in order without duplicates. */
export const richRefs = (src: string): RichRefs => {
  const parts = new Set<string>()
  const cards = new Set<string>()
  const texParts = new Set<string>()
  const walk = (nodes: ReadonlyArray<RichNode>): void => {
    for (const n of nodes) {
      switch (n.type) {
        case "part":
          parts.add(n.id)
          walk(n.children)
          break
        case "card":
          cards.add(n.id)
          walk(n.children)
          break
        case "strong":
        case "em":
          walk(n.children)
          break
        case "math":
          for (const id of texPartIds(n.tex)) texParts.add(id)
          break
        case "text":
        case "code":
          break
      }
    }
  }
  walk(parseRich(src))
  return { parts: [...parts], cards: [...cards], texParts: [...texParts] }
}

/** Plain text of a Rich string (math as its TeX source), for search, titles and aria labels. */
export const richPlainText = (src: string): string => {
  const walk = (nodes: ReadonlyArray<RichNode>): string =>
    nodes
      .map((n) => {
        switch (n.type) {
          case "text":
          case "code":
            return n.text
          case "math":
            return n.tex
          default:
            return walk(n.children)
        }
      })
      .join("")
  return walk(parseRich(src))
}

export interface Ref {
  readonly slug: string
  readonly section: string
  readonly item: string | undefined
}

const refPattern = /^@([a-z0-9][a-z0-9-]*)\/([a-z][a-z0-9_]{0,31})(?:\.([a-z][a-z0-9_]{0,31}))?$/u

/** Read a stable reference `@<lessonSlug>/<sectionId>[.<itemId>]`; undefined if malformed. */
export const parseRef = (src: string): Ref | undefined => {
  const m = refPattern.exec(src.trim())
  if (m === null) return undefined
  return { slug: m[1] ?? "", section: m[2] ?? "", item: m[3] }
}

/** True for a string that is a valid lesson-local id (`^[a-z][a-z0-9_]{0,31}$`). */
export const isId = (s: string): boolean => idPattern.test(s)
