import { expect, test } from "./fixtures.ts"
import { auditFlow } from "./overlap.ts"

test("/path?to=physics.average-speed lists physics.total-time before it and renders the graph", async ({
  page,
}) => {
  await page.goto("/path?to=physics.average-speed")
  await expect(page.getByRole("heading", { level: 1, name: "Learning path" })).toBeVisible()

  const items = page.locator("ol li[data-concept-slug]")
  await expect(items).toHaveCount(2)
  const slugs = await items.evaluateAll((els) => els.map((el) => el.getAttribute("data-concept-slug")))
  expect(slugs).toEqual(["physics.total-time", "physics.average-speed"])

  const flow = page.locator(".lsn-diagram .react-flow")
  await expect(flow.locator(".react-flow__node")).toHaveCount(2)
  const viewport = flow.locator(".react-flow__viewport")
  let last = ""
  await expect
    .poll(
      async () => {
        const now = (await viewport.getAttribute("style")) ?? ""
        const stable = now === last
        last = now
        return stable
      },
      { intervals: [150] },
    )
    .toBe(true)

  const issues = await page.evaluate(auditFlow, { selector: ".lsn-diagram .react-flow", ctx: "path-graph" })
  expect(issues).toEqual([])
})

test("/path search finds concepts and works in Thai", async ({ page }) => {
  await page.goto("/path")
  const search = page.getByRole("searchbox", { name: "Search concepts" })
  await search.fill("average speed")
  await page.getByRole("button", { name: /physics\.average-speed/ }).click()
  await expect(page).toHaveURL(/\/path\?to=physics\.average-speed$/)

  await page.getByRole("group", { name: "Language" }).getByRole("button", { name: "ไทย" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "เส้นทางการเรียนรู้" })).toBeVisible()
  await expect(page.locator('ol li[data-concept-slug="physics.total-time"]')).toContainText("เวลาทั้งหมด")
  await expect(page.locator('ol li[data-concept-slug="physics.average-speed"]')).toContainText("อัตราเร็วเฉลี่ย")
})
