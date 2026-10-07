// Seeds the local D1 + R2 (wrangler's --local state) with the platform's own content: the
// shared concepts in content/concepts and the "Start here" guide (content/guide, en + th) as a
// public lesson owned by @learn, in category platform.guide. The plan is computed by the same
// services as /publish (seed-plan.ts), so the content is validated, hashed and pinned exactly as
// in production. Idempotent: a body already current is not published again.
//
// Run from the repo root: `bun run seed:local` (applies migrations first). State lives in
// apps/worker/.wrangler/state, where `wrangler dev` / `db:migrate:local` keep it; pass
// `--persist-to <dir>` to use another directory. For the deployed site, see seed-remote.ts.
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { getPlatformProxy } from "wrangler"
import { isEmptyPlan, planSeed, planSummary, workerDir } from "./seed-plan.ts"
import { bindingsTarget } from "./seed-targets.ts"

const flag = process.argv.indexOf("--persist-to")
const persistTo = flag === -1 ? join(workerDir, ".wrangler/state") : (process.argv[flag + 1] ?? "")

const migrate = spawnSync(
  "bunx",
  ["wrangler", "d1", "migrations", "apply", "learn", "--local", "--persist-to", persistTo],
  // CI: no confirmation prompt.
  { cwd: workerDir, env: { ...process.env, CI: "true" }, stdio: "inherit" },
)
if (migrate.status !== 0) process.exit(migrate.status ?? 1)

const proxy = await getPlatformProxy<{ DB: D1Database; CONTENT: R2Bucket }>({
  configPath: join(workerDir, "wrangler.jsonc"),
  persist: { path: join(persistTo, "v3") },
  remoteBindings: false,
})
const target = bindingsTarget(proxy.env.DB, proxy.env.CONTENT)
const plan = await planSeed(target, console.log)
if (isEmptyPlan(plan)) {
  console.log("up to date: nothing to write")
} else {
  await target.apply(plan)
  console.log(`wrote ${planSummary(plan)}`)
}
await proxy.dispose()
