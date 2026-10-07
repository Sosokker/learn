// `bun run seed:local`: the seed lives in apps/worker (it uses the Worker's services and
// wrangler's local platform proxy, which resolve from there).
await import("../apps/worker/scripts/seed-local.ts")
