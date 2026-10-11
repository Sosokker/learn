// `bun scripts/publish.ts <file.json | dir> [--slug x] [--url origin] [--dry-run]`: publish a
// lesson with an API token (LEARN_TOKEN). The script lives in apps/worker, where @app/domain and
// @app/api resolve.
await import("../apps/worker/scripts/publish.ts")
