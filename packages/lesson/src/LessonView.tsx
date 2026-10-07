import type { LessonSpec, PinnedConcept, RoleColor } from "@app/domain"
import {
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { AskBar } from "./AskBar.tsx"
import type { Target } from "./cards.ts"
import {
  type InspectorState,
  LessonContext,
  type LessonCtx,
  type LinkScope,
  LinkScopeContext,
  useLesson,
} from "./context.ts"
import { Inspector } from "./Inspector.tsx"
import { Rich } from "./rich.tsx"
import { SectionView, sectionAnchor } from "./sections.tsx"
import { createStore, useStore } from "./store.ts"
import { strings } from "./strings.ts"

export interface LessonViewProps {
  // The lesson body, already decoded with the LessonSpec schema.
  readonly spec: LessonSpec
  // Shared concepts this version uses, with their prerequisites (GET /api/versions/:id/concepts).
  readonly concepts: ReadonlyArray<PinnedConcept>
  // The lesson's slug, the first half of an `@slug/section.item` reference.
  readonly slug: string
  // Language of the app chrome (buttons, badges). The lesson text is in `spec.lang`.
  readonly uiLang: "en" | "th"
  // Called with the built prompt when the reader presses "Copy prompt for pi".
  readonly onAsk?: (prompt: string) => void
  // Start in "let me try" mode.
  readonly initialTryMode?: boolean
  // Hide the table of contents, e.g. when the host page has its own.
  readonly hideToc?: boolean
}

const roleColors: ReadonlySet<RoleColor> = new Set<RoleColor>([
  "red",
  "orange",
  "peach",
  "yellow",
  "mustard",
  "olive",
  "green",
  "teal",
  "cyan",
  "blue",
  "purple",
  "pink",
  "rose",
  "grey",
])
const safeId = /^[a-z][a-z0-9_]{0,31}$/

// Per-lesson CSS: each part's color, and the rule that lights it while `data-hl` on the article
// lists it. Ids and colors are schema-checked; they are checked again here because this is CSS.
export function partStyles(spec: LessonSpec): string {
  const parts = Object.entries(spec.parts).filter(([id, p]) => safeId.test(id) && roleColors.has(p.color))
  const colors = parts.map(([id, p]) => `.lx [data-part="${id}"]{--pc:var(--role-${p.color})}`)
  const edges = parts.map(([id, p]) => `.lx .lx-edge-part-${id} path{stroke:var(--role-${p.color})}`)
  const lit =
    parts.length === 0
      ? []
      : [
          `${parts.map(([id]) => `.lx[data-hl~="${id}"] [data-part="${id}"]`).join(",")}{--pc-now:var(--pc);--op-now:1;--bg-now:color-mix(in oklab,var(--pc) 30%,transparent);--ring-now:var(--pc)}`,
        ]
  return [...colors, ...edges, ...lit].join("\n")
}

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return (
    el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT"
  )
}

function ModeSwitch() {
  const { tryMode, s, uiLang } = useLesson()
  const on = useStore(tryMode, (v) => v)
  return (
    <fieldset className="lx-mode" lang={uiLang}>
      <legend className="lx-sr">{s.modeLabel}</legend>
      <button
        type="button"
        aria-pressed={!on}
        className={on ? "" : "is-on"}
        onClick={() => tryMode.set(false)}
      >
        {s.showMe}
      </button>
      <button type="button" aria-pressed={on} className={on ? "is-on" : ""} onClick={() => tryMode.set(true)}>
        {s.letMeTry}
      </button>
    </fieldset>
  )
}

function TryFlag({ root }: { readonly root: RefObject<HTMLElement | null> }) {
  const { tryMode } = useLesson()
  const on = useStore(tryMode, (v) => v)
  useEffect(() => {
    root.current?.toggleAttribute("data-try", on)
  }, [on, root])
  return null
}

function PartsLegend({ spec }: { readonly spec: LessonSpec }) {
  const { s, uiLang } = useLesson()
  const parts = Object.entries(spec.parts)
  if (parts.length === 0) return null
  return (
    <div className="lx-legend-parts">
      <div className="lx-tree-head" lang={uiLang}>
        {s.partsLegend}
      </div>
      <ul>
        {parts.map(([id, p]) => (
          <li key={id} data-part={id} data-ref={`parts.${id}`}>
            <span className="lx-part lx-part-static" data-part={id}>
              <Rich src={p.label} inline />
            </span>
            <span className="lx-legend-meaning">{p.meaning}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function LessonView(props: LessonViewProps) {
  const { spec, concepts, slug, uiLang, onAsk } = props
  const s = strings[uiLang]
  const root = useRef<HTMLElement>(null)
  const hot = useRef<Element | null>(null)
  const hoverRef = useRef<Element | null>(null)

  // Stores are created once per mounted lesson; a new spec keeps reveals keyed by element id.
  const [stores] = useState(() => ({
    inspector: createStore<InspectorState>({ path: [], preview: null }),
    tryMode: createStore<boolean>(props.initialTryMode ?? false),
    reveals: createStore<ReadonlySet<string>>(new Set()),
    refs: createStore<ReadonlyArray<string>>([]),
  }))
  const ctx: LessonCtx = useMemo(
    () => ({
      spec,
      concepts,
      slug,
      s,
      uiLang,
      ...stores,
      addRef: (key: string) => stores.refs.set((r) => (r.includes(key) ? r : [...r, key])),
    }),
    [spec, concepts, slug, s, uiLang, stores],
  )
  // In the lesson body, hovering a link previews its card and clicking pins it as a new path.
  const scope: LinkScope = useMemo(
    () => ({
      open: (t: Target) => stores.inspector.set({ path: [t], preview: null }),
      preview: (t: Target | null) => stores.inspector.set((v) => ({ ...v, preview: t })),
    }),
    [stores],
  )
  const css = useMemo(() => partStyles(spec), [spec])

  // Hover is written straight to the DOM (data-hl on the article, data-hot on the source), so moving
  // the pointer never re-renders React. CSS does the lighting and dimming.
  const setHot = (el: Element | null) => {
    if (el === hot.current) return
    hot.current?.removeAttribute("data-hot")
    hot.current = el
    const r = root.current
    if (r === null) return
    if (el === null) {
      r.removeAttribute("data-hl")
      return
    }
    el.setAttribute("data-hot", "")
    r.setAttribute("data-hl", el.getAttribute("data-lit") ?? el.getAttribute("data-part") ?? "")
  }
  const onPointerOver = (e: PointerEvent) => {
    const t = e.target instanceof Element ? e.target : null
    setHot(t?.closest("[data-lit],[data-part]") ?? null)
    hoverRef.current = t?.closest("[data-ref]") ?? null
  }
  const onPointerLeave = () => {
    setHot(null)
    hoverRef.current = null
  }
  // Alt-click anything addressable to reference it in the ask bar.
  const onClickCapture = (e: MouseEvent) => {
    if (!e.altKey) return
    const el = e.target instanceof Element ? e.target.closest("[data-ref]") : null
    const key = el?.getAttribute("data-ref")
    if (!key) return
    e.preventDefault()
    e.stopPropagation()
    ctx.addRef(key)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "@" || isTyping(e.target)) return
      const key = hoverRef.current?.getAttribute("data-ref")
      if (!key) return
      e.preventDefault()
      ctx.addRef(key)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [ctx])

  const toc = spec.sections.filter((x) => x.title !== undefined)

  return (
    <LessonContext.Provider value={ctx}>
      <LinkScopeContext.Provider value={scope}>
        <article
          ref={root}
          className="lx"
          lang={spec.lang}
          onPointerOver={onPointerOver}
          onPointerLeave={onPointerLeave}
          onClickCapture={onClickCapture}
        >
          <style>{css}</style>
          <TryFlag root={root} />
          <div className={props.hideToc ? "lx-layout no-toc" : "lx-layout"}>
            {props.hideToc ? null : (
              <nav className="lx-toc" aria-label={s.contents}>
                <div className="lx-toc-head" lang={uiLang}>
                  {s.contents}
                </div>
                <ol>
                  {toc.map((x) => (
                    <li key={x.id}>
                      <a
                        href={`#${sectionAnchor(x.id)}`}
                        onClick={(e) => {
                          e.preventDefault()
                          document.getElementById(sectionAnchor(x.id))?.scrollIntoView({ behavior: "smooth" })
                        }}
                      >
                        {x.title}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            )}
            <div className="lx-main">
              <header className="lx-header">
                <div className="lx-header-row">
                  <span className="lx-badge" lang={uiLang}>
                    {spec.kind}
                  </span>
                  <ModeSwitch />
                </div>
                <h1 className="lx-title">{spec.title}</h1>
                {spec.summary === "" ? null : <p className="lx-summary">{spec.summary}</p>}
              </header>
              {spec.sections.map((sec) => (
                <SectionView key={sec.id} sec={sec} />
              ))}
              <AskBar onAsk={onAsk} />
            </div>
            <Inspector partsLegend={<PartsLegend spec={spec} />} />
          </div>
        </article>
      </LinkScopeContext.Provider>
    </LessonContext.Provider>
  )
}
