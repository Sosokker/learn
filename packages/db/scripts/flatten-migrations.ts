// Copies drizzle-kit's folder migrations (drizzle/<timestamp>_<name>/migration.sql) to the flat
// layout `wrangler d1 migrations apply` reads (migrations/NNNN_<name>.sql). Wrangler records
// applied migrations by file name, so a number, once written, must never point at another
// migration: this refuses to rename or rewrite an existing file.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const source = join(root, "drizzle")
const target = join(root, "migrations")
mkdirSync(target, { recursive: true })

const folders = readdirSync(source, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
  .map((entry) => entry.name)
  .sort()

const existing = readdirSync(target).filter((name) => name.endsWith(".sql"))
const problems: Array<string> = []
const written: Array<string> = []

folders.forEach((folder, index) => {
  const name = `${String(index + 1).padStart(4, "0")}_${folder.replace(/^\d{14}_/, "")}.sql`
  const sql = readFileSync(join(source, folder, "migration.sql"), "utf8")
  const sameNumber = existing.filter((file) => file.startsWith(name.slice(0, 5)) && file !== name)
  if (sameNumber.length > 0) {
    problems.push(
      `${name}: number already used by ${sameNumber.join(", ")} (never renumber applied migrations)`,
    )
    return
  }
  const path = join(target, name)
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== sql)
      problems.push(`${name}: differs from ${folder}; add a new migration instead`)
    return
  }
  writeFileSync(path, sql)
  written.push(name)
})

const known = new Set(
  folders.map(
    (folder, index) => `${String(index + 1).padStart(4, "0")}_${folder.replace(/^\d{14}_/, "")}.sql`,
  ),
)
for (const file of existing) if (!known.has(file)) problems.push(`${file}: no drizzle/ folder produced it`)

if (problems.length > 0) {
  console.error(problems.join("\n"))
  process.exit(1)
}
console.log(written.length === 0 ? "migrations/ is up to date" : `wrote ${written.join(", ")}`)
