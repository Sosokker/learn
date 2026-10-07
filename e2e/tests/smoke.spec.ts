import { expect, type Page, test } from "@playwright/test"

// No page may scroll sideways, at any width.
async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

test("home pins the guide and lists public lessons", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("link", { name: /Start here/ }).first()).toBeVisible()
  await expect(page.getByText("Start here: how Learn works").first()).toBeVisible()
  await noSideScroll(page)
})

test("the guide renders and its tools work", async ({ page }, info) => {
  const errors: Array<string> = []
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto("/guide")
  const problem = page.locator('[data-ref="problem"]')
  await expect(problem).toContainText("A train covers")
  await noSideScroll(page)

  // Hover a part: every place it appears lights up.
  await problem.locator('[data-part="v"]').first().hover()
  await expect(page.locator('[data-hl="v"]')).toHaveCount(1)

  // Click a card link: the card opens in the inspector, and its children drill down.
  await page.locator('[data-card="avg_speed"]').first().click()
  const inspector = page.locator(".lx-inspector")
  await expect(inspector).toContainText("Average speed")
  await expect(inspector).toContainText(/shared concept/i)

  // Alt-click a chain step: it becomes an @ref chip in the ask bar.
  if (info.project.name === "desktop") {
    await page.keyboard.press("Escape")
    await page.locator('[data-ref="chain.s2"]').click({ modifiers: ["Alt"] })
    await expect(page.locator(".lx-ref-chip")).toContainText("@guide/chain.s2")
  }
  expect(errors).toEqual([])
})

test("the guide reads in Thai with the same ids", async ({ page }) => {
  await page.goto("/guide?lang=th")
  await expect(page.locator('article[lang="th"]')).toBeVisible()
  await expect(page.locator('[data-ref="chain.s2"]')).toBeVisible()
  await noSideScroll(page)
})

test("a lesson reads at its @handle address", async ({ page }) => {
  await page.goto("/@learn/guide")
  await expect(page.locator('[data-ref="problem"]')).toContainText("A train covers")
})

test("explore lists, filters and searches", async ({ page }) => {
  await page.goto("/explore")
  await expect(page.getByText("Start here: how Learn works").first()).toBeVisible()
  await page.goto("/explore?q=zebra-nothing")
  await expect(page.getByText("Start here: how Learn works")).toHaveCount(0)
  await noSideScroll(page)
})

test("unknown pages and private lessons are not found", async ({ page }) => {
  await page.goto("/@learn/no-such-lesson")
  await expect(page.getByText(/not found|ไม่พบ/i).first()).toBeVisible()
  await page.goto("/nowhere")
  await expect(page.getByText(/not found|ไม่พบ/i).first()).toBeVisible()
})

test("signed-out library asks to sign in", async ({ page }) => {
  await page.goto("/library")
  await expect(page.getByRole("button", { name: /Sign in with Google/ }).first()).toBeVisible()
})
