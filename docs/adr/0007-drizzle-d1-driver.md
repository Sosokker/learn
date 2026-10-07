# 0007: Drizzle's D1 driver inside an Effect service

**Status:** accepted, 2026-10-07

## Context
The plan was `@effect/sql-d1` + Drizzle (as the template does with Postgres), or Drizzle's own
Effect driver (`drizzle-orm/effect-d1`). With the pinned versions, Drizzle's Effect driver was built
against an Effect 4 beta and fails on 4.0.1 (`Schema.TaggedErrorClass is not a function`).
`@effect/sql-d1` works, but then Drizzle can only build SQL strings, and we would map rows by hand.

## Decision
`packages/db` exposes a `Db` service: the plain `drizzle-orm/d1` database plus `run` (failure is a
defect) and `attempt` (failure is a typed `DbError`, e.g. to turn a unique-constraint failure into
409). Atomic writes use `db.batch([...])`. Better Auth's drizzle adapter uses the same instance.

## Consequences
- Fully typed queries and results, one database object for auth and services.
- No Effect SQL spans per query. Add `Effect.withSpan` around service functions if tracing matters.
- Revisit when Drizzle's Effect driver supports the Effect version we use.
