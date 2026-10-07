# 0001: D1 for metadata, not Postgres

**Status:** accepted, 2026-10-07

## Context
The template uses Postgres through Hyperdrive. Learn runs on Cloudflare only, and the main cost
risk is not storage but rows read per request.

## Decision
Use D1 for users, lessons, versions, tags, concepts, counters and the search index. Keep lesson
bodies out of it (see 0003), so the database stays around 200 MB at 20k users.

## Consequences
- D1 bills rows *scanned*. Every list query has an index that covers it, feed indexes are partial
  (`where visibility = 'public' and deleted_at is null`), paging is keyset, and counters live on rows.
  A missing index is a cost bug.
- No interactive transactions. Writes that belong together go in one `db.batch([...])`, which
  D1 runs atomically. Services read first, then write in one batch.
- FTS5 works, but Thai needs word splitting in the Worker (`Intl.Segmenter`, see design §5), and
  databases with virtual tables can't be exported as is.
- Revisit if we need cross-row constraints that a batch can't express, or a database over 10 GB.
