import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "@playwright/test"

const cli = join(import.meta.dirname, "../../apps/web/public/agent/learn.mjs")
const origin = "http://localhost:5187"

// The bring-your-own-harness contract: public skill/schema assets, and a /create page that tells
// a signed-in user how to connect Claude Code, OpenCode, Codex or pi.

test("the agent skill, CLI and schema are public", async ({ request }) => {
  const schema = await request.get("/api/agent/lesson-schema")
  expect(schema.status()).toBe(200)
  expect(schema.headers()["content-type"]).toContain("application/schema+json")
  const body = (await schema.json()) as { $schema: string; type: string }
  expect(body.$schema).toBe("https://json-schema.org/draft/2020-12/schema")
  expect(body.type).toBe("object")

  const skill = await request.get("/agent/SKILL.md")
  expect(skill.status()).toBe(200)
  expect(await skill.text()).toContain("name: learn")

  const cli = await request.get("/agent/learn.mjs")
  expect(cli.status()).toBe(200)
  expect(await cli.text()).toContain("learn.mjs")
})

test("create explains how to connect an agent", async ({ page }) => {
  // Better Auth's session endpoint is the only thing standing between the page and the setup
  // steps; the rest is the real UI.
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        session: {
          id: "session-test",
          token: "session-token",
          userId: "user-test",
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ipAddress: null,
          userAgent: null,
        },
        user: {
          id: "user-test",
          name: "Agent User",
          email: "agent@example.com",
          emailVerified: true,
          image: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
    }),
  )
  await page.goto("/create")
  await expect(page.getByRole("heading", { level: 1, name: "Create a lesson" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "2. Install the Learn skill" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Claude Code" })).toBeVisible()
  await expect(page.getByText("node learn.mjs init claude")).toBeVisible()
  await expect(page.getByText("export LEARN_TOKEN=lrn_…")).toBeVisible()
  await expect(page.getByText("Write a Learn lesson about why average speed")).toBeVisible()
})

test("the CLI writes the skill into a harness", () => {
  const dir = mkdtempSync(join(tmpdir(), "learn-cli-"))
  try {
    execFileSync(process.execPath, [cli, "init", "claude", "--url", origin], { cwd: dir })
    const claude = join(dir, ".claude/skills/learn/SKILL.md")
    expect(readFileSync(claude, "utf8")).toContain("name: learn")

    execFileSync(process.execPath, [cli, "init", "codex", "--url", origin], { cwd: dir })
    expect(existsSync(join(dir, ".learn/SKILL.md"))).toBe(true)
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain("<!-- learn:start -->")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
