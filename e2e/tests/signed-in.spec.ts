import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { signIn } from "./session.ts"

const guide = JSON.parse(readFileSync(join(import.meta.dirname, "../../content/guide/en.json"), "utf8"))

test.beforeEach(async ({ context }) => signIn(context))

test("a signed-in user sees their settings", async ({ page }) => {
  await page.goto("/settings")
  await expect(page.locator('input[value="e2e"]').first()).toBeVisible()
})

test("a private lesson shows in the owner's library and nowhere else", async ({ page, browser }) => {
  const slug = `e2e-${Date.now()}`
  // The session cookie authenticates API calls made from the page's context.
  const res = await page.request.post("/api/lessons", {
    data: { slug, spec: { ...guide, title: `E2E ${slug}` } },
  })
  expect(res.status()).toBe(200)

  await page.goto("/library")
  await expect(page.getByText(`E2E ${slug}`)).toBeVisible()
  await page.goto(`/@e2e/${slug}`)
  await expect(page.locator('[data-ref="problem"]')).toContainText("A train covers")

  // A stranger gets a 404 page for the same address.
  const stranger = await browser.newPage()
  await stranger.goto(`/@e2e/${slug}`)
  await expect(stranger.getByText(/not found|ไม่พบ/i).first()).toBeVisible()
  await stranger.close()
})
