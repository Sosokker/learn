# 0006. React Flow + dagre for diagrams, KaTeX for math, SVG + a safe parser for plots

- Status: accepted
- Date: 2026-10-07

## Context

The prototype drew graphs with its own layered layout and plots with ad-hoc
JS. The renderer (`packages/lesson`) needs graphs and flows that pan, zoom and
lay themselves out, math that renders the same everywhere, and plots whose
formulas come from untrusted lesson JSON.

## Decision

- **Diagrams:** the `graph` section and the `flow` widget use React Flow
  (`@xyflow/react`) with dagre for layout. Both are lazy-loaded, so they are
  not in the main bundle.
- **Math:** KaTeX, with `trust` limited to `\htmlData{p=<partId>}` so symbols
  can link to parts (ADR 0004).
- **Plots:** plain SVG. Expressions go through the safe parser in
  `packages/domain/src/expr.ts`: numbers, `+ - * / ^`, parentheses, `pi`, `e`,
  param ids, `x`, and a fixed list of math functions. It parses to an AST and
  compiles to a closure. No `eval`, no `Function`, no property access.
- `incline` and `trace` are plain SVG / HTML components.

## Why

- The right tool for each job, instead of one home-made engine.
- React Flow handles interaction (pan, zoom, fit, selection), and dagre gives
  a clean layered layout without hand-placed coordinates.
- KaTeX is fast and renders on the client with no server.
- A small SVG plot is lighter than a charting library, and the safe parser
  lets the validator check expressions on publish.

## Cost

- React Flow + dagre is a large chunk. It loads only when a lesson has a graph
  or a flow.
- New functions in plot expressions need a code change in `expr.ts`.
- KaTeX supports a subset of LaTeX.
