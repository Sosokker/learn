// Seeds the DEPLOYED D1 + R2 with the same content as seed:local (seed-plan.ts): it reads the
// remote seed rows, computes the plan with the /publish services, then uploads the new bodies
// (`wrangler r2 object put --remote`) and runs the statements as one .sql file
// (`wrangler d1 execute --remote --file`). Uses wrangler's own login (`wrangler login`).
// Idempotent: when the remote is current the plan is empty and nothing is written.
//
// Run from the repo root after the first `bun run deploy` (remote migrations must be applied):
//   bun run seed:remote --dry-run   print the plan (SQL + objects), write nothing
//   bun run seed:remote             apply it
// `--local --persist-to <dir>` points the same wrangler code path at local state instead, for
// testing without touching the deployed site.
import { isEmptyPlan, planSeed, planSummary } from "./seed-plan.ts"
import { planSql, wranglerTarget } from "./seed-targets.ts"

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const persistFlag = args.indexOf("--persist-to")
const local = args.includes("--local")
if (local && (persistFlag === -1 || args[persistFlag + 1] === undefined)) {
  console.error("--local needs --persist-to <dir>")
  process.exit(1)
}
const target = wranglerTarget(local ? { persistTo: args[persistFlag + 1] ?? "" } : { remote: true })

console.log(`target: ${target.name}${dryRun ? " (dry run)" : ""}`)
const plan = await planSeed(target, console.log)
if (isEmptyPlan(plan)) {
  console.log("up to date: nothing to write")
  process.exit(0)
}
console.log(`plan: ${planSummary(plan)}`)
if (dryRun) {
  for (const object of plan.objects) console.log(`would put ${object.key} (${object.body.byteLength} bytes)`)
  console.log("would execute:\n")
  console.log(planSql(plan))
  process.exit(0)
}
await target.apply(plan)
console.log(`wrote ${planSummary(plan)}`)
