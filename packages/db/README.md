# @app/db

Drizzle `sqlite-core` tables for D1 (`src/schema.ts`, `src/auth-schema.ts`) and the Effect
`Database` layer (`src/database.ts`): Drizzle only compiles SQL, `@effect/sql-d1` runs it.

## Migrations

drizzle-kit 1.0 writes folders (`drizzle/<timestamp>_<name>/migration.sql` + `snapshot.json`);
`wrangler d1 migrations apply` reads flat files from one directory and records each applied file
by name. So:

- `drizzle/` is drizzle-kit's working directory (snapshots kept, so it can diff the schema).
- `migrations/NNNN_<name>.sql` is what wrangler applies (`migrations_dir` in
  `apps/worker/wrangler.jsonc`). `scripts/flatten-migrations.ts` copies each folder there, in
  timestamp order, and refuses to renumber or rewrite a file that already exists.
- `bun run db:generate` runs both steps. Hand-written SQL (FTS5, seed rows) starts with
  `bunx drizzle-kit generate --custom --name=<name>`, so the snapshot chain stays whole.
- Never edit a committed migration; add a new one.

Apply locally with `bun run db:migrate:local`; `bun run deploy` applies them remotely first.

## FTS and exports

`concept_fts` (FTS5) lives in the main database, so concept writes and their index update stay
in one D1 batch. `wrangler d1 export` refuses databases with virtual tables, and the index is
derived data, so an export drops it first and rebuilds it after:

```sql
DROP TABLE concept_fts;
-- export, then re-run migrations/0002_concept_fts.sql and:
INSERT INTO concept_fts (concept_id, lang, search) SELECT concept_id, lang, search FROM concept_lang;
```

`concept_lang.search` already holds the text with Thai split into words (Intl.Segmenter), so the
rebuild needs no Worker code. D1 Time Travel remains the main backup.
