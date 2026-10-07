// drizzle-kit writes `drizzle/<timestamp>_<name>/migration.sql`; wrangler wants flat
// `migrations/NNNN_<name>.sql` files that it applies in order and records in `d1_migrations`.
// This copies each folder to the next number. Files already in migrations/ are never rewritten,
// because wrangler has applied them somewhere.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const src = join(root, "drizzle")
const out = join(root, "migrations")
mkdirSync(out, { recursive: true })

const done = new Map(
  readdirSync(out)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .map((f) => [f.slice(5, -4), f]),
)
let next = done.size + 1
for (const dir of readdirSync(src)
  .filter((d) => /^\d{14}_/.test(d))
  .sort()) {
  const name = dir.slice(15)
  if (done.has(name)) continue
  const file = join(src, dir, "migration.sql")
  if (!existsSync(file)) continue
  const sql = readFileSync(file, "utf8").replaceAll("--> statement-breakpoint", "")
  const target = `${String(next++).padStart(4, "0")}_${name}.sql`
  writeFileSync(
    join(out, target),
    `-- Generated from drizzle/${dir} by scripts/flatten-migrations.ts\n${sql.trim()}\n`,
  )
  console.log(`wrote migrations/${target}`)
}
