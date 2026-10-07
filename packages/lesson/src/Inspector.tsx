import type { Card } from "@app/domain"
import { type ReactNode, useMemo } from "react"
import {
  cardChildren,
  type Resolved,
  resolveTarget,
  sameTarget,
  type Target,
  targetKey,
  targetRefKey,
} from "./cards.ts"
import { type LinkScope, LinkScopeContext, useLesson } from "./context.ts"
import { Rich } from "./rich.tsx"
import { useStore } from "./store.ts"

function useResolve(t: Target): Resolved {
  const { spec, concepts } = useLesson()
  return useMemo(() => resolveTarget(t, spec, concepts), [t, spec, concepts])
}

// Title of any target as Rich, for breadcrumbs and the tree.
function TargetTitle({ t }: { readonly t: Target }) {
  const r = useResolve(t)
  switch (r.k) {
    case "part":
      return (
        <span className="lx-part" data-part={r.id}>
          <Rich src={r.part.label} inline />
        </span>
      )
    case "card":
    case "concept":
      return <Rich src={r.card.title} inline />
    case "missing":
      return <span>{t.k === "concept" ? t.slug : t.id}</span>
  }
}

function Fields({ card }: { readonly card: Card }) {
  const { s, uiLang } = useLesson()
  const rows = (
    [
      ["says", s.says],
      ["from", s.from],
      ["useWhen", s.useWhen],
      ["units", s.units],
      ["example", s.example],
      ["analogy", s.analogy],
    ] as const
  ).flatMap(([k, label]) => {
    const v = card[k]
    return v === undefined ? [] : [{ k, label, v }]
  })
  if (rows.length === 0) return null
  return (
    <dl className="lx-fields">
      {rows.map((r) => (
        <div key={r.k} className="lx-field">
          <dt lang={uiLang}>{r.label}</dt>
          <dd>
            <Rich src={r.v} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

function CardBody({ r }: { readonly r: Resolved }) {
  const { s, uiLang } = useLesson()
  switch (r.k) {
    case "missing":
      return (
        <p className="lx-muted" lang={uiLang}>
          {s.missingCard}
        </p>
      )
    case "part":
      return (
        <div className="lx-cardview">
          <div className="lx-cardview-badges" lang={uiLang}>
            <span className="lx-role-part" data-part={r.id}>
              <span className="lx-swatch" />
              {s.roles[r.part.role]}
            </span>
          </div>
          <h3 className="lx-cardview-title">
            <span className="lx-part lx-part-static" data-part={r.id}>
              <Rich src={r.part.label} inline />
            </span>
          </h3>
          <p className="lx-cardview-meaning">{r.part.meaning}</p>
          {r.part.body === undefined ? null : <Rich src={r.part.body} />}
          <dl className="lx-fields">
            {r.part.example === undefined ? null : (
              <div className="lx-field">
                <dt lang={uiLang}>{s.example}</dt>
                <dd>
                  <Rich src={r.part.example} />
                </dd>
              </div>
            )}
            {r.part.analogy === undefined ? null : (
              <div className="lx-field">
                <dt lang={uiLang}>{s.analogy}</dt>
                <dd>
                  <Rich src={r.part.analogy} />
                </dd>
              </div>
            )}
          </dl>
        </div>
      )
    case "card":
    case "concept":
      return (
        <div className="lx-cardview">
          <div className="lx-cardview-badges" lang={uiLang}>
            <span className="lx-badge">{s.kinds[r.card.kind]}</span>
            {r.card.kicker !== undefined && r.card.kicker !== s.kinds[r.card.kind] ? (
              <span className="lx-kicker" lang={r.k === "concept" ? r.pinned.spec.lang : undefined}>
                {r.card.kicker}
              </span>
            ) : null}
            {r.k === "concept" ? (
              <>
                <span className="lx-badge lx-badge-shared">
                  <span className="lx-shared-dot" aria-hidden="true" />
                  {s.sharedConcept}
                </span>
                <span className="lx-meta">
                  {s.usedBy(r.pinned.useCount)} · {s.version(r.pinned.version)}
                </span>
              </>
            ) : null}
          </div>
          <h3 className="lx-cardview-title">
            <Rich src={r.card.title} inline />
          </h3>
          {r.k === "concept" ? <div className="lx-cardview-slug">{r.slug}</div> : null}
          <Rich src={r.card.body} />
          <Fields card={r.card} />
        </div>
      )
  }
}

// "Where this sits": the path from the first pinned card down to the current one, then the current
// card's children (its {card} links and, for a shared concept, its needs).
function Tree({
  path,
  onGo,
}: {
  readonly path: ReadonlyArray<Target>
  readonly onGo: (p: ReadonlyArray<Target>) => void
}) {
  const { spec, concepts, s, uiLang } = useLesson()
  const current = path[path.length - 1]
  const children = useMemo(
    () => (current === undefined ? [] : cardChildren(current, spec, concepts)),
    [current, spec, concepts],
  )
  if (current === undefined) return null
  return (
    <div className="lx-tree">
      <div className="lx-tree-head" lang={uiLang}>
        {s.whereThisSits}
      </div>
      <ul>
        {path.map((t, i) => (
          <li key={targetKey(t)} style={{ paddingInlineStart: `${i * 14}px` }}>
            <button
              type="button"
              className={i === path.length - 1 ? "lx-tree-node is-current" : "lx-tree-node"}
              onClick={() => onGo(path.slice(0, i + 1))}
            >
              <span className="lx-tree-glyph" aria-hidden="true">
                {i === 0 ? "◆" : "└"}
              </span>
              <TargetTitle t={t} />
            </button>
          </li>
        ))}
        {children.map((c) => (
          <li key={targetKey(c)} style={{ paddingInlineStart: `${path.length * 14}px` }}>
            <button type="button" className="lx-tree-node is-child" onClick={() => onGo([...path, c])}>
              <span className="lx-tree-glyph" aria-hidden="true">
                ├
              </span>
              <TargetTitle t={c} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Inspector({ partsLegend }: { readonly partsLegend: ReactNode }) {
  const { inspector, s, uiLang, spec, concepts, addRef } = useLesson()
  const path = useStore(inspector, (v) => v.path)
  const preview = useStore(inspector, (v) => v.preview)
  const pinned = path[path.length - 1]
  const showPreview = preview !== null && (pinned === undefined || !sameTarget(preview, pinned))
  const shownPath = showPreview ? [preview] : path
  const shown = shownPath[shownPath.length - 1]
  const resolved = useMemo(
    () => (shown === undefined ? null : resolveTarget(shown, spec, concepts)),
    [shown, spec, concepts],
  )

  const go = (p: ReadonlyArray<Target>) => inspector.set({ path: p, preview: null })
  // Inside the panel a link drills one level down from the card being shown.
  const scope: LinkScope = useMemo(
    () => ({
      open: (t) =>
        inspector.set((v) => {
          const base = v.preview !== null && v.path.length === 0 ? [v.preview] : v.path
          const at = base.findIndex((x) => sameTarget(x, t))
          return { path: at >= 0 ? base.slice(0, at + 1) : [...base, t], preview: null }
        }),
      preview: () => {},
    }),
    [inspector],
  )

  return (
    <aside
      className={`lx-inspector ${path.length > 0 ? "is-open" : ""} ${showPreview ? "is-preview" : ""}`}
      aria-label={s.whereThisSits}
    >
      <LinkScopeContext.Provider value={scope}>
        {shown === undefined || resolved === null ? (
          <div className="lx-inspector-empty">
            <div className="lx-inspector-title" lang={uiLang}>
              {s.inspectorEmpty}
            </div>
            <p className="lx-muted" lang={uiLang}>
              {s.inspectorHint}
            </p>
            {partsLegend}
          </div>
        ) : (
          <>
            <div className="lx-inspector-bar">
              <nav className="lx-crumbs" aria-label="breadcrumb">
                {shownPath.map((t, i) => (
                  <span key={targetKey(t)} className="lx-crumb">
                    {i > 0 ? (
                      <span className="lx-crumb-sep" aria-hidden="true">
                        ›
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className={i === shownPath.length - 1 ? "lx-crumb-btn is-current" : "lx-crumb-btn"}
                      onClick={() => go(shownPath.slice(0, i + 1))}
                    >
                      <TargetTitle t={t} />
                    </button>
                  </span>
                ))}
              </nav>
              <div className="lx-inspector-actions" lang={uiLang}>
                {showPreview ? null : (
                  <button
                    type="button"
                    className="lx-btn lx-btn-ghost"
                    onClick={() => addRef(targetRefKey(shown))}
                  >
                    {s.addRef}
                  </button>
                )}
                {path.length > 0 && !showPreview ? (
                  <button
                    type="button"
                    className="lx-btn lx-btn-ghost lx-btn-icon"
                    aria-label={s.close}
                    title={s.close}
                    onClick={() => go([])}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            </div>
            <div className="lx-inspector-body" data-ref={targetRefKey(shown)}>
              <CardBody r={resolved} />
              <Tree path={shownPath} onGo={go} />
            </div>
          </>
        )}
      </LinkScopeContext.Provider>
    </aside>
  )
}
