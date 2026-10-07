// Rich text: the one markup lessons use (see lesson.ts). The grammar is fixed and has no escape
// hatch to HTML, so a renderer can turn the tree into elements without sanitizing anything.
//
//   [partId:label]   {cardId|label}   $tex$   $$tex$$   **bold**   *italic*   `code`   \$
//
// Anything that does not match a rule is plain text: a stray `[`, `{` or `*` is never an error.
// Blank lines split paragraphs; a single newline is a line break.

export type RichNode =
  | { readonly t: "text"; readonly v: string }
  | { readonly t: "br" }
  | { readonly t: "math"; readonly tex: string; readonly display: boolean }
  | { readonly t: "code"; readonly v: string }
  | { readonly t: "bold"; readonly c: ReadonlyArray<RichNode> }
  | { readonly t: "italic"; readonly c: ReadonlyArray<RichNode> }
  | { readonly t: "part"; readonly id: string; readonly c: ReadonlyArray<RichNode> }
  | { readonly t: "card"; readonly id: string; readonly c: ReadonlyArray<RichNode> }

export type RichParagraph = ReadonlyArray<RichNode>

const idHead = /^[a-z][a-z0-9_]{0,31}/

// Finds the `close` that ends a span starting at `from`, skipping over $math$ so a `]` or `}` inside
// TeX doesn't end the label early.
function findClose(src: string, from: number, close: string): number {
  let i = from
  while (i < src.length) {
    const ch = src[i]
    if (ch === "\\") {
      i += 2
      continue
    }
    if (ch === "$") {
      const end = findMathEnd(src, i)
      if (end < 0) return -1
      i = end
      continue
    }
    if (ch === "\n" && src[i + 1] === "\n") return -1
    if (src.startsWith(close, i)) return i
    i++
  }
  return -1
}

// Returns the index just after the closing delimiter of the math span that starts at `start`.
function findMathEnd(src: string, start: number): number {
  const display = src.startsWith("$$", start)
  const open = display ? 2 : 1
  let i = start + open
  while (i < src.length) {
    const ch = src[i]
    if (ch === "\\") {
      i += 2
      continue
    }
    if (ch === "$") {
      if (display) return src.startsWith("$$", i) ? i + 2 : -1
      return i > start + 1 ? i + 1 : -1
    }
    i++
  }
  return -1
}

function pushText(out: Array<RichNode>, v: string) {
  if (v === "") return
  const last = out[out.length - 1]
  if (last?.t === "text") out[out.length - 1] = { t: "text", v: last.v + v }
  else out.push({ t: "text", v })
}

export function parseInline(src: string): Array<RichNode> {
  const out: Array<RichNode> = []
  let i = 0
  while (i < src.length) {
    const ch = src[i] as string
    if (ch === "\\" && src[i + 1] === "$") {
      pushText(out, "$")
      i += 2
      continue
    }
    if (ch === "\n") {
      out.push({ t: "br" })
      i++
      continue
    }
    if (ch === "$") {
      const end = findMathEnd(src, i)
      if (end > 0) {
        const display = src.startsWith("$$", i)
        const d = display ? 2 : 1
        out.push({ t: "math", tex: src.slice(i + d, end - d), display })
        i = end
        continue
      }
    }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1)
      if (end > i + 1) {
        out.push({ t: "code", v: src.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    if (ch === "[" || ch === "{") {
      const id = idHead.exec(src.slice(i + 1))?.[0]
      const sep = ch === "[" ? ":" : "|"
      if (id !== undefined && src[i + 1 + id.length] === sep) {
        const start = i + 2 + id.length
        const end = findClose(src, start, ch === "[" ? "]" : "}")
        if (end >= start) {
          out.push({ t: ch === "[" ? "part" : "card", id, c: parseInline(src.slice(start, end)) })
          i = end + 1
          continue
        }
      }
    }
    if (ch === "*") {
      const strong = src.startsWith("**", i)
      const d = strong ? 2 : 1
      const end = findClose(src, i + d, strong ? "**" : "*")
      // `*` followed by a space is a multiplication sign or a bullet, not emphasis.
      if (end > i + d && src[i + d] !== " ") {
        out.push({ t: strong ? "bold" : "italic", c: parseInline(src.slice(i + d, end)) })
        i = end + d
        continue
      }
    }
    pushText(out, ch)
    i++
  }
  return out
}

export function parseRich(src: string): Array<RichParagraph> {
  return src
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map(parseInline)
}

// ── TeX. `\p{partId}{…}` marks a hoverable symbol. KaTeX gets `\htmlData{part=partId}{…}` instead,
// which is the only `trust` command the renderer allows.
const texPartRe = /\\p\{([a-z][a-z0-9_]{0,31})\}/g

export function texPartRefs(tex: string): Array<string> {
  return [...tex.matchAll(texPartRe)].map((m) => m[1] as string)
}

export function texToKatex(tex: string): string {
  return tex.replace(texPartRe, "\\htmlData{part=$1}")
}

// Every reference inside one Rich string: part links, card links, and \p{} inside its math.
export interface RichRefs {
  readonly parts: Array<string>
  readonly cards: Array<string>
}

export function richRefs(src: string): RichRefs {
  const parts: Array<string> = []
  const cards: Array<string> = []
  const walk = (nodes: ReadonlyArray<RichNode>) => {
    for (const n of nodes) {
      switch (n.t) {
        case "part":
          parts.push(n.id)
          walk(n.c)
          break
        case "card":
          cards.push(n.id)
          walk(n.c)
          break
        case "bold":
        case "italic":
          walk(n.c)
          break
        case "math":
          parts.push(...texPartRefs(n.tex))
          break
      }
    }
  }
  for (const p of parseRich(src)) walk(p)
  return { parts, cards }
}

// Plain text of a Rich string, for feeds, search and `aria-label`s. Math keeps its TeX source.
export function richToPlain(src: string): string {
  const walk = (nodes: ReadonlyArray<RichNode>): string =>
    nodes
      .map((n) => {
        switch (n.t) {
          case "text":
          case "code":
            return n.v
          case "br":
            return " "
          case "math":
            return n.tex.replace(texPartRe, "")
          default:
            return walk(n.c)
        }
      })
      .join("")
  return parseRich(src).map(walk).join("\n\n")
}
