// KaTeX for lesson math. `trust` allows only `\htmlData{p=<partId>}` (KaTeX reports it as the
// attribute `data-p`), which is what the `\p` macro
// expands to: `\p{id}{body}` → `\htmlData{p=id}{body}`. The output is KaTeX's own HTML (no user
// HTML can pass through), so it is safe to set as innerHTML. Each element made by `\p` carries
// `data-p="<id>"`, which the lesson's highlight CSS and hover handling read.

import { idPattern } from "@app/domain"
import katex, { type TrustContext } from "katex"

const trust = (context: TrustContext): boolean =>
  context.command === "\\htmlData" &&
  Object.entries(context.attributes).every(([key, value]) => key === "data-p" && idPattern.test(value))

// Rendering is pure and lessons repeat formulas (inspector, hover), so keep a bounded cache.
const cache = new Map<string, string>()
const cacheLimit = 600

/** KaTeX HTML for a TeX string. Never throws: a TeX error renders as KaTeX's red error text. */
export const renderTex = (tex: string, display: boolean): string => {
  const key = `${display ? "D" : "I"}${tex}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  let html: string
  try {
    html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      strict: false,
      output: "htmlAndMathml",
      trust,
      // A fresh object each time: KaTeX may write into `macros`.
      macros: { "\\p": "\\htmlData{p=#1}{#2}" },
    })
  } catch {
    html = `<span class="lsn-tex-error">${escapeHtml(tex)}</span>`
  }
  if (cache.size >= cacheLimit) {
    const oldest = cache.keys().next()
    if (oldest.done !== true) cache.delete(oldest.value)
  }
  cache.set(key, html)
  return html
}

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

// Reads a `{…}` group starting at `i` (src[i] must be `{`). Returns the inner text and the index
// after the closing brace, or undefined when unbalanced. `\{` and `\}` do not count.
const readGroup = (src: string, i: number): { readonly inner: string; readonly next: number } | undefined => {
  if (src[i] !== "{") return undefined
  let depth = 0
  for (let j = i; j < src.length; j++) {
    const c = src[j]
    if (c === "\\") {
      j++
      continue
    }
    if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) return { inner: src.slice(i + 1, j), next: j + 1 }
    }
  }
  return undefined
}

/**
 * Clean TeX for a prompt or plain copy: `\p{id}{body}` becomes `{body}` (grouping kept, so
 * `\p{v}{\bar v}^2` stays valid TeX). Anything malformed is left as it is.
 */
export const stripTexParts = (tex: string): string => {
  let out = ""
  let i = 0
  while (i < tex.length) {
    if (tex.startsWith("\\p", i) && !/[a-zA-Z]/.test(tex[i + 2] ?? "")) {
      let j = i + 2
      while (tex[j] === " ") j++
      const id = readGroup(tex, j)
      if (id !== undefined) {
        let k = id.next
        while (tex[k] === " ") k++
        const body = readGroup(tex, k)
        if (body !== undefined) {
          out += `{${stripTexParts(body.inner)}}`
          i = body.next
          continue
        }
      }
    }
    if (tex[i] === "\\" && i + 1 < tex.length) {
      out += tex.slice(i, i + 2)
      i += 2
      continue
    }
    out += tex[i]
    i++
  }
  return out
}

// Readable text for TeX where markup cannot render (tooltips, aria labels, search, layout
// sizing). Covers what lessons use: Greek letters, common operators, accents, fractions, roots,
// \text and simple sub/superscripts. Anything else loses its backslash and braces, so the
// result is never raw TeX.
const symbols: Readonly<Record<string, string>> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  cdot: "·",
  times: "×",
  div: "÷",
  pm: "±",
  mp: "∓",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  neq: "≠",
  ne: "≠",
  approx: "≈",
  sim: "∼",
  equiv: "≡",
  propto: "∝",
  infty: "∞",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  iff: "⇔",
  implies: "⇒",
  sum: "Σ",
  prod: "Π",
  int: "∫",
  partial: "∂",
  nabla: "∇",
  circ: "∘",
  degree: "°",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  cup: "∪",
  cap: "∩",
  forall: "∀",
  exists: "∃",
  ldots: "…",
  cdots: "⋯",
  dots: "…",
  quad: " ",
  qquad: " ",
  ",": " ",
  ";": " ",
  ":": " ",
  "!": "",
  " ": " ",
  "{": "{",
  "}": "}",
  "%": "%",
  "&": "&",
  "#": "#",
  _: "_",
  $: "$",
  sin: "sin",
  cos: "cos",
  tan: "tan",
  log: "log",
  ln: "ln",
  exp: "exp",
  lim: "lim",
  max: "max",
  min: "min",
  left: "",
  right: "",
  big: "",
  Big: "",
  displaystyle: "",
}
// Combining marks for accents: `\bar v` → v̄.
const accents: Readonly<Record<string, string>> = {
  bar: "\u0304",
  overline: "\u0304",
  hat: "\u0302",
  widehat: "\u0302",
  tilde: "\u0303",
  widetilde: "\u0303",
  vec: "\u20d7",
  dot: "\u0307",
  ddot: "\u0308",
}
// Commands whose argument is shown as it is.
const passThrough = new Set([
  "text",
  "textrm",
  "textbf",
  "textit",
  "mathrm",
  "mathbf",
  "mathit",
  "mathsf",
  "mathcal",
  "mathbb",
  "operatorname",
  "boldsymbol",
  "underline",
  "mbox",
])
const sub: Readonly<Record<string, string>> = Object.fromEntries(
  [..."0123456789+-=()aehijklmnoprstuvx"].map((c, i) => [c, [..."₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ"][i] ?? c]),
)
const sup: Readonly<Record<string, string>> = Object.fromEntries(
  [..."0123456789+-=()in"].map((c, i) => [c, [..."⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁱⁿ"][i] ?? c]),
)
const script = (s: string, table: Readonly<Record<string, string>>, mark: string): string => {
  const chars = [...s]
  if (chars.length > 0 && chars.every((c) => table[c] !== undefined))
    return chars.map((c) => table[c]).join("")
  return chars.length === 1 ? `${mark}${s}` : `${mark}(${s})`
}

/** Readable Unicode text for a TeX string (`\bar v` → `v̄`, `\frac{d}{T}` → `d/T`). */
export const texToText = (tex: string): string => {
  // One argument: a `{…}` group or a single (possibly escaped) token.
  const arg = (i: number): { readonly text: string; readonly next: number } => {
    let j = i
    while (tex[j] === " ") j++
    const g = readGroup(tex, j)
    if (g !== undefined) return { text: texToText(g.inner), next: g.next }
    if (tex[j] === "\\") {
      const m = /^\\([a-zA-Z]+|.)/.exec(tex.slice(j))
      const name = m?.[1] ?? ""
      return { text: symbols[name] ?? name, next: j + 1 + name.length }
    }
    return { text: tex[j] ?? "", next: j + 1 }
  }
  let out = ""
  let i = 0
  while (i < tex.length) {
    const c = tex[i] ?? ""
    if (c === "\\") {
      const m = /^\\([a-zA-Z]+|.)/.exec(tex.slice(i))
      const name = m?.[1] ?? ""
      const after = i + 1 + name.length
      if (name === "p") {
        // `\p{id}{body}`: keep only the body.
        const id = arg(after)
        const body = arg(id.next)
        out += body.text
        i = body.next
      } else if (name === "frac" || name === "dfrac" || name === "tfrac") {
        const num = arg(after)
        const den = arg(num.next)
        const wrap = (s: string) => (/^[\p{L}\p{N}\p{M}.]+$/u.test(s) ? s : `(${s})`)
        out += `${wrap(num.text)}/${wrap(den.text)}`
        i = den.next
      } else if (name === "sqrt") {
        const a = arg(after)
        out += a.text.length === 1 ? `√${a.text}` : `√(${a.text})`
        i = a.next
      } else if (accents[name] !== undefined) {
        const a = arg(after)
        out += [...a.text].length === 1 ? `${a.text}${accents[name]}` : a.text
        i = a.next
      } else if (passThrough.has(name)) {
        const a = arg(after)
        out += a.text
        i = a.next
      } else {
        out += symbols[name] ?? name
        i = after
      }
    } else if (c === "_" || c === "^") {
      const a = arg(i + 1)
      out += c === "_" ? script(a.text, sub, "_") : script(a.text, sup, "^")
      i = a.next
    } else if (c === "{" || c === "}") {
      i++
    } else if (c === "~") {
      out += " "
      i++
    } else {
      out += c
      i++
    }
  }
  return out.replace(/\s+/g, " ").trim()
}
