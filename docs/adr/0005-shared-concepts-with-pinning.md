# 0005. Shared concepts, pinned per lesson version

- Status: accepted
- Date: 2026-10-07

## Context

Many lessons explain the same ideas (average speed, Newton's second law).
Writing the same card again in every lesson costs LLM tokens and gives
readers different explanations of one idea. But a lesson must not change
under its readers when someone edits a shared card.

## Decision

- A concept is a `ConceptSpec` (one card, `needs`, `aliases`) with a dotted
  slug, such as `physics.average-speed`. It is stored like a lesson: immutable
  versions per language, bodies in R2 by hash (tables `concept`,
  `concept_version`, `concept_lang`, `concept_need`).
- A lesson points a local card id at it:
  `"cards": { "avg": { "concept": "physics.average-speed" } }`, or
  `"…@2"` for a specific version. Local `{avg|…}` links keep working.
- On publish, the server resolves each pointer to a concept version in the
  lesson's language and writes the pin to `lesson_version_concept`. Later
  concept versions never change an existing lesson version.
- The reader gets the pinned specs from
  `GET /api/lessons/:id/versions/:versionId/concepts`.
- The lesson-writing agent searches `GET /api/concepts?q=` (FTS5, Thai split
  into words) before it writes a new card.
- Rules: a concept card can't link to parts or cards (it has no lesson
  context), `needs` must exist and stay acyclic, all languages agree on kind
  and needs, and only the creator can add versions.

## Why

- Write once, reuse many times: fewer tokens, one consistent explanation.
- Pinning keeps every published lesson version reproducible.
- The `needs` edges form a global concept graph for drill-down.

## Cost

- Concept improvements reach a lesson only when the lesson publishes a new
  version.
- Only the creator can change a concept. There is no review, fork or transfer
  flow yet.
- A concept slug is global, so names need care (first come, first served).
