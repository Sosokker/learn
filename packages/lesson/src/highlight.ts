// Linked highlight, done in CSS so it reaches every element that carries `data-p` (React spans,
// KaTeX output from `\p`, SVG marks, React Flow nodes) without re-rendering the lesson.
//
// - `partColorCss` gives each `[data-p~="id"]` its role color as `--c` (static per lesson).
// - `highlightCss` dims every `[data-p]` and lights the given ids; the lesson writes it into a
//   <style> element on hover / focus / pin.
// Ids match `^[a-z][a-z0-9_]{0,31}$` (the validator enforces it; anything else is skipped), so
// they are safe inside a CSS attribute selector.

import { idPattern, type Part } from "@app/domain"

/** Selector of one lesson root. `scope` is a sanitized id from `scopeId`. */
export const rootSelector = (scope: string): string => `.lsn[data-lesson="${scope}"]`

/** A CSS-safe scope id from React's `useId()` output. */
export const scopeId = (reactId: string): string => `l${reactId.replace(/[^a-zA-Z0-9]/g, "")}`

const sel = (id: string): string => `[data-p~="${id}"]`

export const partColorCss = (scope: string, parts: Readonly<Record<string, Part>>): string => {
  const root = rootSelector(scope)
  return Object.entries(parts)
    .filter(([id]) => idPattern.test(id))
    .map(([id, p]) => `${root} ${sel(id)}{--c:var(--color-role-${p.color})}`)
    .join("\n")
}

const svgShapes = "g,path,line,polyline,polygon,circle,rect,text,ellipse"

export const highlightCss = (scope: string, ids: ReadonlyArray<string>): string => {
  const safe = ids.filter((id) => idPattern.test(id))
  if (safe.length === 0) return ""
  const root = rootSelector(scope)
  const on = `:is(${safe.map(sel).join(",")})`
  return [
    `${root} [data-p]{opacity:.28}`,
    `${root} ${on}{opacity:1}`,
    `${root} ${on}:not(${svgShapes}){background:color-mix(in oklab,var(--c) 24%,transparent)}`,
    `${root} svg ${on}{filter:drop-shadow(0 0 4px var(--c))}`,
  ].join("\n")
}
