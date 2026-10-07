# 0004. No user HTML or JS: a typed LessonSpec and a fixed widget catalog

- Status: accepted
- Date: 2026-10-07

## Context

The prototype was hand-written HTML and JS. Lessons are now shared in public
and written by an LLM (pi). Shared HTML or scripts would be an XSS risk, and
every lesson would behave a little differently.

## Decision

- A lesson is data only: the `LessonSpec` Effect Schema in
  `packages/domain/src/lesson.ts`, decoded strictly (unknown keys are errors).
- Text uses a small Rich markup with a fixed, total parser
  (`packages/domain/src/rich.ts`). There is no raw HTML. The renderer builds
  every element itself.
- Math goes through KaTeX with `trust` limited to `\htmlData` with one
  `data-p` attribute that matches the id pattern (the `\p{part}{…}` macro).
- Visuals are a closed widget catalog (`plot`, `table`, `flow`, `incline`,
  `trace`). Plot expressions use a safe parser with no `eval` (ADR 0006).
- `validateLesson` checks every reference, id, range and expression. The server
  runs it on publish, and pi can run it offline.

## Why

- Safe to share: a public lesson can't run code in a reader's browser.
- Every lesson gets the same hover, link, card and `@ref` behavior.
- pi can't break the page. A wrong lesson fails validation with a path and a
  code instead.
- The same schema exports JSON Schema for pi.

## Cost

- Anything outside the catalog needs a new widget in code, a schema change and
  a renderer change. Authors can't ship a one-off visual.
- Schema changes must stay readable for stored bodies (`schema: 1`). A future
  version needs an upgrade step on read.
