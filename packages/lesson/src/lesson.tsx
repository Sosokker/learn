// <Lesson>: renders a LessonSpec. Ports the prototype's engine: linked highlight, inspector with
// drill-down, try mode, @refs and the prompt for pi.
//
// Interaction is delegated at the lesson root, like the prototype: any element with
// `data-target` (a part, card link, step, proof line, graph node, …) or with `data-p` (a `\p`
// symbol inside KaTeX) previews on hover / focus, pins on click, and Alt-click or `@` adds its
// nearest `data-ref` to the question. The highlight itself is CSS (highlight.ts), written into a
// <style> element, so hovering never re-renders the lesson body.

import type { ConceptSpec, LessonLang, LessonSpec } from "@app/domain"
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import { anchorOf } from "./anchors.ts"
import { AskBar, type AskPayload } from "./ask.tsx"
import {
  LessonContext,
  type LessonContextValue,
  type Mode,
  ModeContext,
  type ModeContextValue,
} from "./context.tsx"
import { highlightCss, partColorCss, rootSelector, scopeId } from "./highlight.ts"
import { Inspector, PartsLegend } from "./inspector.tsx"
import { makeTranslate } from "./messages.ts"
import {
  buildModel,
  highlightFor,
  type LessonModel,
  parseTargetKey,
  type Target,
  targetKey,
} from "./model.ts"
import { copyText } from "./refs.ts"
import { SectionView } from "./sections/index.tsx"
import { graphEdgeId } from "./widgets/diagrams.tsx"

// Same layout effect on the client, no warning on the server.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

/** Reading progress: the sections that came into view, and the last one. */
export interface LessonProgress {
  readonly seen: ReadonlyArray<string>
  readonly last: string | null
  readonly total: number
}

export interface LessonProps {
  readonly spec: LessonSpec
  /** Shared concepts the lesson's `{ concept }` cards point at (any language; the lesson's wins). */
  readonly concepts?: ReadonlyArray<ConceptSpec> | undefined
  /** Language of the renderer's own labels. Defaults to the lesson's language. */
  readonly lang?: LessonLang | undefined
  /** Lesson slug for `@ref`s (`@<slug>/<section>.<item>`). Defaults to "lesson". */
  readonly slug?: string | undefined
  /** How many lessons use each shared concept, for the "used in N lessons" note. */
  readonly conceptUses?: Readonly<Record<string, number>> | undefined
  /** Called with the prompt when the learner copies it from the ask bar (it is always copied). */
  readonly onAskPrompt?: ((payload: AskPayload) => void) | undefined
  /** Link to another lesson, for `units` entries with a `lessonSlug`. */
  readonly lessonHref?: ((slug: string) => string) | undefined
  /** Sections already seen (saved progress), counted from the start. Ids not in the spec are dropped. */
  readonly seen?: ReadonlyArray<string> | undefined
  /**
   * Called when a section comes into view for the first time, or another section becomes the
   * last one seen. Only then does the toolbar show how much was read. The host throttles saving.
   */
  readonly onProgress?: ((progress: LessonProgress) => void) | undefined
  /**
   * Open the host's comments on a piece: called with its anchor (see anchors.ts) from the pinned
   * inspector card and the ask bar's chips. Without it, no comment buttons show.
   */
  readonly onDiscuss?: ((anchor: string) => void) | undefined
  /** Hide the title / summary header (when the host page renders its own). */
  readonly hideHeader?: boolean | undefined
  readonly className?: string | undefined
}

/** Extra CSS for "related" items: the lines a proof line uses, the needs of a graph node. */
const relatedCss = (scope: string, model: LessonModel, t: Target | undefined): string => {
  if (t?.kind !== "item") return ""
  const it = model.item(t.section, t.item)
  if (it === undefined) return ""
  const root = rootSelector(scope)
  const itemSel = (section: string, item: string) => `${root} [data-target="item:${section}.${item}"]`
  const out: Array<string> = [`${itemSel(t.section, t.item)}{--lsn-row:var(--lsn-row-on);opacity:1}`]
  if (it.type === "proof") {
    for (const d of it.line.deps) out.push(`${itemSel(t.section, d)}{--lsn-row:var(--lsn-row-dep)}`)
  }
  if (it.type === "graph") {
    const nodes = it.section.nodes
    const needs = new Set<string>()
    const stack = [it.node.id]
    while (stack.length > 0) {
      const id = stack.pop()
      for (const d of nodes.find((n) => n.id === id)?.needs ?? []) {
        if (!needs.has(d)) {
          needs.add(d)
          stack.push(d)
        }
      }
    }
    const inside = new Set([it.node.id, ...needs])
    for (const d of needs) out.push(`${itemSel(t.section, d)}{--lsn-row:var(--lsn-row-dep);opacity:1}`)
    for (const n of nodes) {
      if (!inside.has(n.id)) continue
      for (const d of n.needs) {
        if (inside.has(d))
          out.push(
            `${root} [data-id="${graphEdgeId(t.section, d, n.id)}"] .react-flow__edge-path{stroke:var(--lsn-edge-on)!important;stroke-width:2!important}`,
          )
      }
    }
  }
  return out.join("\n")
}

const Body = memo(function Body(props: { readonly spec: LessonSpec }) {
  return props.spec.sections.map((s) => <SectionView key={s.id} section={s} />)
})

const targetFromElement = (
  el: Element | null,
  root: HTMLElement,
): { el: Element; target: Target } | undefined => {
  const hit = el?.closest("[data-target],[data-p]")
  if (hit == null || !root.contains(hit)) return undefined
  const key = hit.getAttribute("data-target")
  if (key !== null) {
    const target = parseTargetKey(key)
    return target === undefined ? undefined : { el: hit, target }
  }
  const p = (hit.getAttribute("data-p") ?? "").split(" ")[0]
  return p === undefined || p === "" ? undefined : { el: hit, target: { kind: "part", id: p } }
}

const refFromElement = (el: Element | null): Target | undefined => {
  const key = el?.closest("[data-ref]")?.getAttribute("data-ref")
  return key == null ? undefined : parseTargetKey(key)
}

const sameTarget = (a: Target | undefined, b: Target | undefined) =>
  a === b || (a !== undefined && b !== undefined && targetKey(a) === targetKey(b))

export function Lesson(props: LessonProps) {
  const { spec } = props
  const lang = props.lang ?? spec.lang
  const slug = props.slug ?? "lesson"
  const scope = scopeId(useId())
  const rootRef = useRef<HTMLDivElement>(null)
  const hlRef = useRef<HTMLStyleElement>(null)
  const liveRef = useRef<HTMLParagraphElement>(null)

  const model = useMemo(
    () => buildModel({ spec, slug, concepts: props.concepts, conceptUses: props.conceptUses }),
    [spec, slug, props.concepts, props.conceptUses],
  )
  const t = useMemo(() => makeTranslate(lang), [lang])

  const [hover, setHover] = useState<Target | undefined>(undefined)
  const [stack, setStack] = useState<ReadonlyArray<Target>>([])
  const [refs, setRefs] = useState<ReadonlyArray<Target>>([])
  const [mode, setMode] = useState<Mode>("show")
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set())
  const sectionIds = useMemo(() => spec.sections.map((s) => s.id), [spec.sections])
  const [reading, setReading] = useState<{
    readonly seen: ReadonlySet<string>
    readonly last: string | null
  }>(() => ({ seen: new Set(props.seen?.filter((id) => sectionIds.includes(id))), last: null }))

  // Latest state for the native listeners below (they are attached once).
  const latest = useRef({ hover, stack })
  latest.current = { hover, stack }

  const announce = useCallback((text: string) => {
    const el = liveRef.current
    if (el === null) return
    el.textContent = ""
    // A fresh text node so screen readers announce a repeat of the same message.
    requestAnimationFrame(() => {
      el.textContent = text
    })
  }, [])

  const addRef = useCallback((target: Target) => {
    setRefs((old) => (old.some((r) => sameTarget(r, target)) ? old : [...old, target]))
  }, [])

  const pin = useCallback((target: Target) => {
    setStack((old) => (old.length === 1 && sameTarget(old[0], target) ? [] : [target]))
  }, [])

  const copy = useCallback(
    (text: string, message?: string) => {
      void copyText(text).then((ok) => announce(ok ? (message ?? text) : t("ref.copyFailed")))
    },
    [announce, t],
  )

  const preview = useCallback((target: Target | undefined) => setHover(target), [])

  const onDiscuss = props.onDiscuss
  const discuss = useMemo(
    () =>
      onDiscuss === undefined
        ? undefined
        : (target: Target) => {
            const anchor = anchorOf(target)
            if (anchor !== undefined) onDiscuss(anchor)
          },
    [onDiscuss],
  )

  const ctx = useMemo<LessonContextValue>(
    () => ({ model, t, actions: { pin, addRef, copy, preview, discuss }, lessonHref: props.lessonHref }),
    [model, t, pin, addRef, copy, preview, discuss, props.lessonHref],
  )

  const modeCtx = useMemo<ModeContextValue>(
    () => ({
      mode,
      revealed,
      reveal: (keys) => setRevealed((old) => new Set([...old, ...keys])),
    }),
    [mode, revealed],
  )

  // Delegated pointer / focus / click / key handling.
  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const inPanel = (el: Element) => el.closest(".lsn-inspector, .lsn-ask") !== null
    const onOver = (e: Event) => {
      // A tap is a click (it pins); a touch "hover" would stick until the next tap.
      if (e instanceof PointerEvent && e.pointerType === "touch") return
      const el = e.target instanceof Element ? e.target : null
      if (el === null || inPanel(el)) return
      const hit = targetFromElement(el, root)
      setHover((old) => (sameTarget(old, hit?.target) ? old : hit?.target))
    }
    const onLeave = () => setHover(undefined)
    const onFocusOut = (e: FocusEvent) => {
      if (!(e.relatedTarget instanceof Node) || !root.contains(e.relatedTarget)) setHover(undefined)
    }
    const onClick = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target : null
      if (el === null) return
      const hit = targetFromElement(el, root)
      const interactive = el.closest("button, input, select, textarea, a, label, [data-no-pin]")
      if (interactive !== null && interactive !== hit?.el && !interactive.contains(hit?.el ?? null)) return
      if (hit === undefined) return
      if (el.closest(".lsn-ask") !== null) return
      if (e.altKey) {
        e.preventDefault()
        addRef(refFromElement(hit.el) ?? hit.target)
        return
      }
      if (el.closest(".lsn-inspector") !== null) {
        // Drill down: a link inside the pinned card opens the next level.
        setStack((old) => {
          const top = old[old.length - 1]
          if (sameTarget(top, hit.target)) return old
          return old.length === 0 ? [hit.target] : [...old, hit.target]
        })
        return
      }
      pin(hit.target)
    }
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof Element ? e.target : null
      if (el?.closest("input, textarea, select, [contenteditable]") != null) return
      if (e.key === "Escape") {
        setStack([])
        return
      }
      if (e.key === "@") {
        const { hover: h, stack: s } = latest.current
        const focused = el === null ? undefined : (refFromElement(el) ?? targetFromElement(el, root)?.target)
        const target = focused ?? h ?? s[s.length - 1]
        if (target !== undefined) {
          e.preventDefault()
          addRef(target)
        }
      }
    }
    root.addEventListener("pointerover", onOver)
    root.addEventListener("focusin", onOver)
    root.addEventListener("pointerleave", onLeave)
    root.addEventListener("focusout", onFocusOut)
    root.addEventListener("click", onClick)
    root.addEventListener("keydown", onKey)
    return () => {
      root.removeEventListener("pointerover", onOver)
      root.removeEventListener("focusin", onOver)
      root.removeEventListener("pointerleave", onLeave)
      root.removeEventListener("focusout", onFocusOut)
      root.removeEventListener("click", onClick)
      root.removeEventListener("keydown", onKey)
    }
  }, [addRef, pin])

  // `@` while hovering works even when focus is elsewhere on the page, and Escape unpins when
  // nothing has focus (e.g. after a click that removed the focused element).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (rootRef.current === null) return
      const el = e.target instanceof Element ? e.target : null
      if (e.key === "Escape" && (el === null || el === document.body || el === document.documentElement)) {
        setStack([])
        return
      }
      if (e.key !== "@") return
      if (
        el !== null &&
        (rootRef.current.contains(el) || el.closest("input, textarea, select, [contenteditable]") !== null)
      )
        return
      const { hover: h, stack: s } = latest.current
      const target = h ?? s[s.length - 1]
      if (target !== undefined) {
        e.preventDefault()
        addRef(target)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [addRef])

  // Reading progress. A section counts as seen when half of it is in view, or, for a section
  // taller than the screen, when it fills 40% of the screen.
  const tracking = props.onProgress !== undefined
  useEffect(() => {
    const root = rootRef.current
    if (!tracking || root === null || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(
      (entries) => {
        const hits = entries
          .filter(
            (entry) =>
              entry.isIntersecting &&
              (entry.intersectionRatio >= 0.5 ||
                entry.intersectionRect.height >= 0.4 * (entry.rootBounds?.height ?? window.innerHeight)),
          )
          .map((entry) => entry.target.getAttribute("data-ref")?.slice("section:".length))
          .filter((id): id is string => id !== undefined && sectionIds.includes(id))
        if (hits.length === 0) return
        setReading((old) => {
          const last = hits.toSorted((a, b) => sectionIds.indexOf(a) - sectionIds.indexOf(b)).at(-1) ?? null
          const fresh = hits.filter((id) => !old.seen.has(id))
          if (fresh.length === 0 && last === old.last) return old
          return { seen: fresh.length === 0 ? old.seen : new Set([...old.seen, ...fresh]), last }
        })
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    )
    for (const el of root.querySelectorAll('.lsn-main [data-ref^="section:"]')) observer.observe(el)
    return () => observer.disconnect()
  }, [tracking, sectionIds])

  const onProgress = props.onProgress
  useEffect(() => {
    if (onProgress === undefined || reading.last === null) return
    onProgress({
      seen: sectionIds.filter((id) => reading.seen.has(id)),
      last: reading.last,
      total: sectionIds.length,
    })
  }, [onProgress, reading, sectionIds])

  const pinned = stack[stack.length - 1]
  const shown = hover ?? pinned
  const showingPinned = pinned !== undefined && (hover === undefined || sameTarget(hover, pinned))

  useIsoLayoutEffect(() => {
    const el = hlRef.current
    if (el === null) return
    el.textContent = `${highlightCss(scope, highlightFor(model, shown))}\n${relatedCss(scope, model, shown)}`
  }, [scope, model, shown])

  const colorCss = useMemo(() => partColorCss(scope, spec.parts), [scope, spec.parts])

  const setTry = (next: Mode) => {
    setMode(next)
    setRevealed(new Set())
  }

  const sheetOpen = pinned !== undefined
  const classes = ["lsn", props.className ?? ""].filter(Boolean).join(" ")

  return (
    <LessonContext value={ctx}>
      <ModeContext value={modeCtx}>
        <div ref={rootRef} className={classes} data-lesson={scope} data-mode={mode} lang={spec.lang}>
          <style>{colorCss}</style>
          <style ref={hlRef} />
          {props.hideHeader !== true && (
            <header className="lsn-header">
              <h1 className="lsn-title">{spec.title}</h1>
              {spec.summary !== "" && <p className="lsn-summary">{spec.summary}</p>}
            </header>
          )}
          <div className="lsn-toolbar">
            {tracking && sectionIds.length > 0 && (
              <span className="lsn-progress">
                <span className="lsn-progress-bar" aria-hidden>
                  <span style={{ width: `${(100 * reading.seen.size) / sectionIds.length}%` }} />
                </span>
                {t("progress.read", { seen: reading.seen.size, total: sectionIds.length })}
              </span>
            )}
            <fieldset className="lsn-mode" aria-label={t("mode.label")}>
              <legend className="lsn-sr-only">{t("mode.label")}</legend>
              <button
                type="button"
                className="lsn-mode-btn"
                aria-pressed={mode === "show"}
                onClick={() => setTry("show")}
              >
                {t("mode.show")}
              </button>
              <button
                type="button"
                className="lsn-mode-btn"
                aria-pressed={mode === "try"}
                onClick={() => setTry("try")}
              >
                {t("mode.try")}
              </button>
            </fieldset>
          </div>
          <div className="lsn-layout">
            <main className="lsn-main">
              <Body spec={spec} />
              <AskBar
                refs={refs}
                onAdd={addRef}
                onRemove={(i) => setRefs((old) => old.filter((_, k) => k !== i))}
                onAsk={props.onAskPrompt}
              />
            </main>
            <aside
              className="lsn-side"
              data-open={sheetOpen ? "" : undefined}
              aria-label={t("inspector.title")}
            >
              <div className="lsn-inspector">
                <Inspector
                  target={shown}
                  pinned={showingPinned}
                  stack={stack}
                  onNavigate={setStack}
                  onClose={() => setStack([])}
                />
              </div>
              <PartsLegend />
            </aside>
          </div>
          <p ref={liveRef} className="lsn-sr-only" aria-live="polite" />
        </div>
      </ModeContext>
    </LessonContext>
  )
}
