// Where a seed plan is read from and applied to. Objects go first: a row never points at a body
// that is not stored yet.
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Schema } from "effect"
import { inlineStatement, type SeedPlan, type SeedSource, workerDir } from "./seed-plan.ts"

export interface SeedTarget extends SeedSource {
  readonly name: string
  readonly apply: (plan: SeedPlan) => Promise<void>
}

const WranglerResults = Schema.Array(
  Schema.Struct({ results: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) }),
)

const bucketName = "learn-content"
const databaseName = "learn"

// The plan as one .sql file: every batch, in order, with values inlined.
export const planSql = (plan: SeedPlan) =>
  plan.batches
    .map((batch, index) =>
      [`-- batch ${index + 1}`, ...batch.map((statement) => `${inlineStatement(statement)};`)].join("\n"),
    )
    .join("\n\n")

// wrangler's local platform proxy (getPlatformProxy bindings): seed:local.
export const bindingsTarget = (db: D1Database, bucket: R2Bucket): SeedTarget => ({
  name: "local D1 + R2 (platform proxy)",
  query: async (statements) => {
    const results = await db.batch<Record<string, unknown>>(
      statements.map((statement) => db.prepare(statement)),
    )
    return results.map((result) => result.results)
  },
  getObject: async (key) => {
    const object = await bucket.get(key)
    return object === null ? undefined : new Uint8Array(await object.arrayBuffer())
  },
  apply: async (plan) => {
    for (const object of plan.objects) {
      await bucket.put(object.key, object.body, { httpMetadata: { contentType: "application/json" } })
    }
    // Each service batch stays one D1 batch (one transaction), as in the Worker.
    for (const batch of plan.batches) {
      await db.batch(batch.map((statement) => db.prepare(statement.sql).bind(...statement.params)))
    }
  },
})

// The wrangler CLI, with wrangler's own login (no API token from env). `--remote` for seed:remote;
// `--local --persist-to <dir>` runs the same code path against local state, for testing.
export const wranglerTarget = (
  location: { readonly remote: true } | { readonly persistTo: string },
): SeedTarget => {
  const flags = "remote" in location ? ["--remote"] : ["--local", "--persist-to", location.persistTo]
  const wrangler = (args: ReadonlyArray<string>, options: { readonly allowFailure?: boolean } = {}) => {
    const result = spawnSync("bunx", ["wrangler", ...args, ...flags], {
      cwd: workerDir,
      env: { ...process.env, CI: "true" },
      maxBuffer: 64 * 1024 * 1024,
    })
    if (result.status !== 0 && options.allowFailure !== true) {
      throw new Error(
        `wrangler ${args.join(" ")} failed:\n${result.stderr.toString()}${result.stdout.toString()}`,
      )
    }
    return result
  }
  const scratch = () => mkdtempSync(join(tmpdir(), "learn-seed-"))

  return {
    name:
      "remote" in location
        ? "remote D1 + R2 (wrangler --remote)"
        : `local state ${location.persistTo} (wrangler --local)`,
    query: async (statements) => {
      // One wrangler call; it splits on `;` and returns one result per statement. The snapshot
      // queries hold no `;` inside literals (slugs and ids only).
      const result = wrangler(["d1", "execute", databaseName, "--json", "--command", statements.join(";\n")])
      const parsed = Schema.decodeUnknownSync(Schema.fromJsonString(WranglerResults))(
        result.stdout.toString(),
      )
      if (parsed.length !== statements.length) {
        throw new Error(`expected ${statements.length} results from wrangler d1, got ${parsed.length}`)
      }
      return parsed.map((entry) => entry.results)
    },
    getObject: async (key) => {
      const dir = scratch()
      try {
        const file = join(dir, "object")
        const result = wrangler(["r2", "object", "get", `${bucketName}/${key}`, "--file", file], {
          allowFailure: true,
        })
        if (result.status === 0) return new Uint8Array(readFileSync(file))
        const output = `${result.stderr.toString()}${result.stdout.toString()}`
        if (/not found|does not exist|NoSuchKey/i.test(output)) return undefined
        throw new Error(`wrangler r2 object get ${key} failed:\n${output}`)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    apply: async (plan) => {
      const dir = scratch()
      try {
        for (const object of plan.objects) {
          const file = join(dir, "object.json")
          writeFileSync(file, object.body)
          wrangler([
            "r2",
            "object",
            "put",
            `${bucketName}/${object.key}`,
            "--file",
            file,
            "--content-type",
            "application/json",
          ])
          console.log(`put ${object.key}`)
        }
        if (plan.batches.length > 0) {
          const file = join(dir, "seed.sql")
          writeFileSync(file, `${planSql(plan)}\n`)
          wrangler(["d1", "execute", databaseName, "--yes", "--file", file])
          console.log(`executed ${plan.batches.flat().length} statements`)
        }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  }
}
