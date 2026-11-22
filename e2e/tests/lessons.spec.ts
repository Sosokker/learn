import { readdirSync } from "node:fs"
import { join } from "node:path"
import type { Locator, Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { auditFlow, auditSvgs } from "./overlap.ts"

const lessonsDir = join(import.meta.dirname, "../../lessons")
const lessonSlugs = readdirSync(lessonsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

interface Range {
  readonly min: number
  readonly max: number
  readonly step: number
  readonly initial: number
}

const setRange = (input: Locator, value: number) =>
  input.evaluate((el, v) => {
    if (!(el instanceof HTMLInputElement)) throw new Error("not an input")
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    setter?.call(el, String(v))
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
  }, value)

const readRange = (input: Locator): Promise<Range> =>
  input.evaluate((el) => {
    if (!(el instanceof HTMLInputElement)) throw new Error("not an input")
    return { min: Number(el.min), max: Number(el.max), step: Number(el.step), initial: Number(el.value) }
  })

const sweep = (r: Range, points = 5): Array<number> => {
  const snap = (v: number) =>
    Math.min(r.max, Math.max(r.min, r.min + Math.round((v - r.min) / r.step) * r.step))
  const out = new Set<number>()
  for (let i = 0; i < points; i++) {
    out.add(Number(snap(r.min + ((r.max - r.min) * i) / (points - 1)).toFixed(6)))
  }
  return [...out]
}

const auditSectionSvgs = async (page: Page, sectionId: string, ctx: string): Promise<Array<string>> => {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  return page.evaluate(auditSvgs, { selector: `#section-${sectionId} svg`, ctx })
}

const auditSectionWidgets = async (page: Page, slug: string, lang: "en" | "th"): Promise<Array<string>> => {
  const issues: Array<string> = []
  const sections = await page.locator(".lsn section[id^='section-']").evaluateAll((els) =>
    els.map((el) => ({
      id: el.id.slice(8),
      hasSvg: el.querySelector("svg.lsn-plot-svg, svg.lsn-incline-svg") !== null,
      hasFlow: el.querySelector(".lsn-diagram") !== null,
    })),
  )

  for (const section of sections) {
    const locator = page.locator(`.lsn #section-${section.id}`)
    await locator.scrollIntoViewIfNeeded()

    if (section.hasSvg) {
      const inputs = locator.locator('input[type="range"]')
      const count = await inputs.count()
      const ranges: Array<Range> = []
      for (let i = 0; i < count; i++) ranges.push(await readRange(inputs.nth(i)))

      issues.push(...(await auditSectionSvgs(page, section.id, `${slug}/${lang}/${section.id} initial`)))
      if (lang === "en") {
        for (const [i, r] of ranges.entries()) {
          for (const v of sweep(r)) {
            await setRange(inputs.nth(i), v)
            issues.push(
              ...(await auditSectionSvgs(page, section.id, `${slug}/${lang}/${section.id} p${i}=${v}`)),
            )
          }
          await setRange(inputs.nth(i), r.initial)
        }
        for (let mask = 0; mask < 2 ** ranges.length; mask++) {
          const vals: Array<string> = []
          for (const [i, r] of ranges.entries()) {
            const v = mask & (1 << i) ? r.max : r.min
            await setRange(inputs.nth(i), v)
            vals.push(String(v))
          }
          issues.push(
            ...(await auditSectionSvgs(
              page,
              section.id,
              `${slug}/${lang}/${section.id} corner ${vals.join(",")}`,
            )),
          )
        }
        for (const [i, r] of ranges.entries()) await setRange(inputs.nth(i), r.initial)
      }
    }

    if (section.hasFlow) {
      const flow = locator.locator(".react-flow")
      await expect(flow.locator(".react-flow__node").first()).toBeVisible()
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
      issues.push(
        ...(await page.evaluate(auditFlow, {
          selector: `#section-${section.id} .react-flow`,
          ctx: `${slug}/${lang}/${section.id}`,
        })),
        ...(await auditSectionSvgs(page, section.id, `${slug}/${lang}/${section.id}`)),
      )
    }
  }
  return [...new Set(issues)]
}

test.describe("lessons render and overlap audit", () => {
  for (const slug of lessonSlugs) {
    test(`${slug} renders cleanly in en and th and passes overlap audit`, async ({ page }) => {
      await page.goto(`/@learn/${slug}`)
      const lesson = page.locator(".lsn")
      await expect(lesson).toHaveAttribute("lang", "en")
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      await expect(lesson.locator(".katex-error, .lsn-tex-error")).toHaveCount(0)

      const enIssues = await auditSectionWidgets(page, slug, "en")
      expect(enIssues).toEqual([])

      await page.getByRole("group", { name: "Language" }).getByRole("button", { name: "ไทย" }).click()
      await expect(lesson).toHaveAttribute("lang", "th")
      await expect(lesson.locator(".katex-error, .lsn-tex-error")).toHaveCount(0)

      const thIssues = await auditSectionWidgets(page, slug, "th")
      expect(thIssues).toEqual([])
    })
  }
})
