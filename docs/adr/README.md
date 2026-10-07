# Architecture decisions

Short records of choices that differ from the projects template or that a newcomer would question.
Each says what we chose, why, and what would make us change it.

| # | Decision |
|---|---|
| [0001](0001-d1-for-metadata.md) | D1 (SQLite) for metadata, not Postgres |
| [0002](0002-wrangler-and-vite-plugin.md) | wrangler + `@cloudflare/vite-plugin`, not Alchemy |
| [0003](0003-r2-immutable-bodies.md) | Lesson bodies are immutable JSON in R2, named by hash |
| [0004](0004-no-user-html-or-js.md) | Lessons are data: no user HTML or JS |
| [0005](0005-shared-concepts.md) | Shared concepts, pinned per lesson version |
| [0006](0006-react-flow-for-graphs.md) | React Flow + dagre for graphs and flows; plain SVG for plots |
| [0007](0007-drizzle-d1-driver.md) | Drizzle's D1 driver inside an Effect service, not an Effect SQL driver |
