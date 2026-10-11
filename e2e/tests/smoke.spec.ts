import { expect, openGuide, test } from "./fixtures.ts"

const guideTitle = "Start here: how Learn works"

test("home shows the pinned guide and the guide in the new feed", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1, name: "Learn by taking lessons apart" })).toBeVisible()
  const pinned = page.getByRole("region", { name: "Pinned" })
  await expect(pinned.getByRole("link", { name: "Start here: how a lesson works" })).toHaveAttribute(
    "href",
    "/guide",
  )
  const feed = page.getByRole("region", { name: "New lessons" })
  await expect(feed.getByText(guideTitle)).toBeVisible()
})

test("the guide renders in English with math and every section", async ({ page }) => {
  await openGuide(page)
  const lesson = page.locator(".lsn")
  await expect(lesson).toHaveAttribute("lang", "en")
  await expect(page.getByRole("heading", { level: 1, name: guideTitle })).toBeVisible()
  for (const id of ["welcome", "problem", "chain", "plot", "graph", "trap", "recall"]) {
    await expect(lesson.locator(`#section-${id}`)).toBeAttached()
  }
  await expect(lesson.locator(".katex").first()).toBeVisible()
  await expect(lesson.locator(".katex-error, .lsn-tex-error")).toHaveCount(0)
})

test("hovering a part lights every occurrence; clicking pins it", async ({ page }) => {
  await openGuide(page)
  const lesson = page.locator(".lsn")
  const all = lesson.locator('[data-p~="t2"]')
  expect(await all.count()).toBeGreaterThan(1)
  const other = lesson.locator('[data-p]:not([data-p~="t2"])').first()

  const part = lesson.locator('#section-problem button.lsn-part[data-p="t2"]').first()
  await part.hover()
  await expect(other).toHaveCSS("opacity", "0.28")
  const opacities = await all.evaluateAll((els) => els.map((e) => getComputedStyle(e).opacity))
  expect(opacities.every((o) => o === "1")).toBe(true)
  // The inspector previews the hovered part.
  const inspector = page.locator(".lsn-inspector")
  await expect(inspector).not.toContainText("pinned")

  await part.click()
  await expect(inspector.locator(".lsn-inspector-title")).toContainText("pinned")
  await expect(inspector.getByRole("button", { name: "Close" })).toBeVisible()
  // Moving away keeps the pinned part lit.
  await page.mouse.move(0, 0)
  await expect(other).toHaveCSS("opacity", "0.28")
})

test("the 'where this sits' tree renders math titles as math", async ({ page }) => {
  await openGuide(page)
  await page.locator('.lsn #section-problem button.lsn-part[data-p="v"]').first().click()
  const tree = page.getByRole("navigation", { name: "Where this sits" })
  await expect(tree.locator(".lsn-tree-row.is-cur .katex")).toBeVisible()
  // KaTeX keeps the TeX in hidden MathML for screen readers; check only the visible rendering.
  const shown = await tree.evaluate((el) => {
    const copy = el.cloneNode(true)
    if (!(copy instanceof HTMLElement)) return ""
    for (const m of copy.querySelectorAll(".katex-mathml")) m.remove()
    return copy.textContent ?? ""
  })
  expect(shown).toContain("Average speed")
  expect(shown).not.toContain("\\")
})

test("switching to ไทย renders the Thai guide", async ({ page }) => {
  await openGuide(page)
  await page.getByRole("group", { name: "Language" }).getByRole("button", { name: "ไทย" }).click()
  await expect(page.locator(".lsn")).toHaveAttribute("lang", "th")
  await expect(page.getByRole("heading", { level: 1, name: "เริ่มที่นี่: Learn ใช้งานยังไง" })).toBeVisible()
  await expect(page.locator("html")).toHaveAttribute("lang", "th")
})

test("a deep link to /@learn/start-here works through the %40 redirect", async ({ page }) => {
  const response = await page.goto("/@learn/start-here")
  expect(response?.status()).toBe(200)
  await expect(page).toHaveURL(/\/@learn\/start-here$/)
  await expect(page.getByRole("heading", { level: 1, name: guideTitle })).toBeVisible()
})

test("an unknown path shows the 404 page", async ({ page }) => {
  await page.goto("/nope")
  await expect(page.getByText("Page not found")).toBeVisible()
  await expect(page.getByRole("link", { name: "Back to Library" })).toBeVisible()
})

test("the library asks a signed-out visitor to sign in", async ({ page }) => {
  await page.goto("/library")
  await expect(page.getByText("Sign in to use your library")).toBeVisible()
  await expect(page.locator("#main").getByRole("button", { name: "Sign in with Google" })).toBeVisible()
})

test.describe("at 375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } })
  for (const path of ["/", "/guide"]) {
    test(`${path} has no horizontal scroll`, async ({ page }) => {
      if (path === "/guide") await openGuide(page)
      else {
        await page.goto(path)
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      }
      const { scroll, client } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }))
      expect(scroll).toBeLessThanOrEqual(client)
    })
  }
})
