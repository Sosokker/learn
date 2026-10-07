# 0005: Shared concepts, pinned per lesson version

**Status:** accepted, 2026-10-07

## Decision
A concept (e.g. `physics.average-speed`) is a `ConceptSpec`: one card per language, `needs`
(prerequisite concepts) and `aliases`. A lesson points a local card id at it:
`"avg_speed": { "concept": "physics.average-speed" }` (or `@2` to pin a version). On publish, the
server resolves the concept's current version in the lesson's language and its prerequisites,
transitively, and records them in `lesson_version_concept`. The reader gets them in one bundle per
version (`GET /api/versions/:id/concepts`, cached for a year).

## Why
- The lesson-writing agent searches `/api/concepts?q=` and reuses a concept instead of writing a
  card again: fewer tokens, and one consistent explanation across lessons.
- Readers can drill down into prerequisites in every lesson.
- Pinning means a later edit to a concept never changes a lesson someone already read.

## Consequences
- Only a concept's author can publish new versions (v1). Shared editing needs a review model later.
- A concept card cannot link parts or cards: it has no lesson around it. Its children are `needs`.
- `concept.use_count` is recounted in the publish batch from current lesson versions.
