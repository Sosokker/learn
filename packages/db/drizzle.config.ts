import { defineConfig } from "drizzle-kit"

// drizzle-kit writes one folder per migration; scripts/flatten-migrations.ts copies them to the
// flat `migrations/NNNN_name.sql` layout that `wrangler d1 migrations apply` reads.
export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/schema.ts", "./src/auth-schema.ts"],
  out: "./drizzle",
})
