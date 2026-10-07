import { parseRich, type RichNode, texToKatex } from "@app/domain"
import katex from "katex"
import { type ReactNode, useContext, useMemo } from "react"
import { type LinkScope, LinkScopeContext } from "./context.ts"

// KaTeX output is the only HTML the renderer injects. Its input is lesson TeX, and `trust` admits
// only \htmlData, which is how `\p{part}{…}` becomes a hoverable `data-part` span.
const katexCache = new Map<string, string>()

export function katexHtml(tex: string, display: boolean): string {
  const key = `${display ? "D" : "I"}${tex}`
  const hit = katexCache.get(key)
  if (hit !== undefined) return hit
  const html = katex.renderToString(texToKatex(tex), {
    displayMode: display,
    throwOnError: false,
    strict: false,
    trust: (ctx) => ctx.command === "\\htmlData",
    output: "html",
  })
  if (katexCache.size > 2000) katexCache.clear()
  katexCache.set(key, html)
  return html
}

export function Tex({ tex, display = false }: { readonly tex: string; readonly display?: boolean }) {
  return (
    <span
      className={display ? "lx-math lx-math-display" : "lx-math"}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output, see katexHtml
      dangerouslySetInnerHTML={{ __html: katexHtml(tex, display) }}
    />
  )
}

function renderNodes(nodes: ReadonlyArray<RichNode>, scope: LinkScope, inLink: boolean): Array<ReactNode> {
  return nodes.map((n, i) => {
    const key = i
    switch (n.t) {
      case "text":
        return n.v
      case "br":
        return <br key={key} />
      case "math":
        return <Tex key={key} tex={n.tex} display={n.display} />
      case "code":
        return (
          <code key={key} className="lx-code">
            {n.v}
          </code>
        )
      case "bold":
        return <strong key={key}>{renderNodes(n.c, scope, inLink)}</strong>
      case "italic":
        return <em key={key}>{renderNodes(n.c, scope, inLink)}</em>
      case "part":
        // A link inside a link would nest buttons, so the inner one is a plain colored span.
        return inLink ? (
          <span key={key} className="lx-part" data-part={n.id}>
            {renderNodes(n.c, scope, true)}
          </span>
        ) : (
          <button
            key={key}
            type="button"
            className="lx-part"
            data-part={n.id}
            onClick={(e) => {
              if (!e.altKey) scope.open({ k: "part", id: n.id })
            }}
          >
            {renderNodes(n.c, scope, true)}
          </button>
        )
      case "card":
        return inLink ? (
          <span key={key} className="lx-card">
            {renderNodes(n.c, scope, true)}
          </span>
        ) : (
          <button
            key={key}
            type="button"
            className="lx-card"
            data-card={n.id}
            onPointerEnter={() => scope.preview({ k: "card", id: n.id })}
            onPointerLeave={() => scope.preview(null)}
            onFocus={() => scope.preview({ k: "card", id: n.id })}
            onBlur={() => scope.preview(null)}
            onClick={(e) => {
              if (!e.altKey) scope.open({ k: "card", id: n.id })
            }}
          >
            {renderNodes(n.c, scope, true)}
          </button>
        )
    }
    return null
  })
}

// Renders Rich markup as React elements. Lesson text only ever becomes text nodes, never HTML.
// `inline` joins paragraphs into one span, for titles, labels and table cells.
export function Rich({ src, inline = false }: { readonly src: string; readonly inline?: boolean }) {
  const scope = useContext(LinkScopeContext)
  const paras = useMemo(() => parseRich(src), [src])
  if (inline) {
    return (
      <span className="lx-rich">
        {paras.map((p, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs have no identity beyond order
          <span key={i}>
            {i > 0 ? " " : null}
            {renderNodes(p, scope, false)}
          </span>
        ))}
      </span>
    )
  }
  return (
    <div className="lx-rich lx-prose">
      {paras.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs have no identity beyond order
        <p key={i}>{renderNodes(p, scope, false)}</p>
      ))}
    </div>
  )
}
