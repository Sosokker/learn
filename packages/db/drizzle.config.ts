import { defineConfig } from "drizzle-kit"

// drizzle-kit writes folder migrations (drizzle/<timestamp>_<name>/migration.sql + snapshot.json),
// which `wrangler d1 migrations apply` does not read. scripts/flatten-migrations.ts copies each one
// to migrations/NNNN_<name>.sql, the flat layout wrangler applies. Hand-written SQL (FTS5, seeds)
// goes through `drizzle-kit generate --custom` so the snapshot chain stays whole.
export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/auth-schema.ts", "./src/schema.ts"],
  out: "./drizzle",
})
