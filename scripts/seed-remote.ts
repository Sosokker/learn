// `bun run seed:remote [--dry-run]`: the seed lives in apps/worker (it uses the Worker's services
// and wrangler, which resolve from there).
await import("../apps/worker/scripts/seed-remote.ts")
