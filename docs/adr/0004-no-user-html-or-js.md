# 0004: Lessons are data: no user HTML or JS

**Status:** accepted, 2026-10-07

## Decision
A lesson is a `LessonSpec`: typed JSON validated with Effect Schema. Text uses a small markup
(Rich) with a fixed grammar and no HTML. Visuals come from a closed widget catalog with
parameters. Widget expressions go through a tiny parser that builds closures and never calls
`eval` or `Function`. KaTeX runs with `trust` limited to `\htmlData`.

## Why
Lessons are shared in public and written by an LLM. Data can't run code, so a shared lesson is
safe to open, and every lesson gets the same hover, link, card and `@ref` behavior. pi can't
break the reader.

## Consequences
- Anything a lesson needs that the catalog lacks is a schema change plus a renderer component.
- The renderer turns the Rich tree into React elements. Only KaTeX output goes through
  `innerHTML`.
