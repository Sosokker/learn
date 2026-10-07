// Rich text renderer: builds every element from the parsed tree (`parseRich`), never from HTML.
// Math is KaTeX output (see tex.ts). Parts and cards are real <button>s, so they are keyboard
// focusable; the lesson root handles hover, focus and click for every `data-target` by delegation.

import { parseRich, parseRichBlocks, type RichNode } from "@app/domain"
import { createContext, Fragment, memo, type ReactNode, useContext, useMemo } from "react"
import { useLesson } from "./context.tsx"
import { type Target, titleOf } from "./model.ts"
import { renderTex } from "./tex.ts"

export const Tex = memo(function Tex(props: { readonly tex: string; readonly display?: boolean }) {
  const display = props.display === true
  const html = useMemo(() => renderTex(props.tex, display), [props.tex, display])
  return (
    <span
      className={display ? "lsn-math lsn-math-display" : "lsn-math"}
      // KaTeX output with `trust` limited to \htmlData{p=<id>}: no user HTML reaches here.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX HTML, see tex.ts
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
})

const textWithBreaks = (text: string, breaks: boolean): ReactNode => {
  if (!text.includes("\n")) return text
  if (!breaks) return text.replace(/\s*\n\s*/g, " ")
  const lines = text.split("\n")
  return lines.map((l, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: lines of one static string
    <Fragment key={i}>
      {i > 0 && <br />}
      {l}
    </Fragment>
  ))
}

// Inside another button (a diagram node, a quiz option, a card link) links must not be buttons:
// parts keep their color and highlight as plain spans, card links become plain text.
const PlainLinks = createContext(false)

function RichNodeView(props: { readonly node: RichNode; readonly breaks: boolean }) {
  const { model, t } = useLesson()
  const plain = useContext(PlainLinks)
  const n = props.node
  switch (n.type) {
    case "text":
      return textWithBreaks(n.text, props.breaks)
    case "code":
      return <code>{n.text}</code>
    case "math":
      return <Tex tex={n.tex} display={n.display} />
    case "strong":
      return (
        <strong>
          <Nodes nodes={n.children} breaks={props.breaks} />
        </strong>
      )
    case "em":
      return (
        <em>
          <Nodes nodes={n.children} breaks={props.breaks} />
        </em>
      )
    case "part": {
      const part = model.part(n.id)
      if (part === undefined) return <Nodes nodes={n.children} breaks={props.breaks} />
      if (plain) {
        return (
          <span className="lsn-part" data-p={n.id} data-role={part.role}>
            <Nodes nodes={n.children} breaks={false} />
          </span>
        )
      }
      return (
        <button
          type="button"
          className="lsn-part"
          data-p={n.id}
          data-role={part.role}
          data-target={`part:${n.id}`}
          aria-description={`${t(`role.${part.role}`)}: ${part.meaning}`}
        >
          <Nodes nodes={n.children} breaks={false} />
        </button>
      )
    }
    case "card": {
      if (plain || model.card(n.id) === undefined) return <Nodes nodes={n.children} breaks={props.breaks} />
      return (
        <button type="button" className="lsn-term" data-target={`card:${n.id}`}>
          <Nodes nodes={n.children} breaks={false} />
        </button>
      )
    }
  }
}

function Nodes(props: { readonly nodes: ReadonlyArray<RichNode>; readonly breaks: boolean }) {
  return props.nodes.map((n, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: nodes of one static parse tree
    <RichNodeView key={i} node={n} breaks={props.breaks} />
  ))
}

/**
 * Inline Rich (titles, labels, cells). Newlines become spaces. `plain` renders links as
 * non-interactive spans, for Rich inside another button.
 */
export const RichInline = memo(function RichInline(props: {
  readonly src: string
  readonly plain?: boolean
}) {
  const nodes = useMemo(() => parseRich(props.src), [props.src])
  const inner = <Nodes nodes={nodes} breaks={false} />
  return props.plain === true ? <PlainLinks value>{inner}</PlainLinks> : inner
})

/**
 * The title of a target as Rich (math through KaTeX), with links as plain spans so it can sit
 * inside a button. For tree rows and suggestion lists; CSS clips long titles.
 */
export function TargetTitle(props: { readonly target: Target }) {
  const { model } = useLesson()
  return <RichInline src={titleOf(model, props.target)} plain />
}

/** Block Rich: one <p> per paragraph (blank line), single newlines as <br>. */
export const RichBlocks = memo(function RichBlocks(props: {
  readonly src: string
  readonly className?: string
}) {
  const blocks = useMemo(() => parseRichBlocks(props.src), [props.src])
  return (
    <div className={props.className === undefined ? "lsn-rich" : `lsn-rich ${props.className}`}>
      {blocks.map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs of one static string
        <p key={i}>
          <Nodes nodes={b} breaks />
        </p>
      ))}
    </div>
  )
})
