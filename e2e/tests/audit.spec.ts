import type { Locator, Page } from "@playwright/test"
import { expect, openGuide, test } from "./fixtures.ts"
import { auditFlow, auditSvgs } from "./overlap.ts"

// Sets a range input the way a user drag does: React listens for `input`, so set the value
// through the native setter (React's own setter would swallow it) and fire the event.
const setRange = (input: Locator, value: number) =>
  input.evaluate((el, v) => {
    if (!(el instanceof HTMLInputElement)) throw new Error("not an input")
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    setter?.call(el, String(v))
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
  }, value)

interface Range {
  readonly min: number
  readonly max: number
  readonly step: number
  readonly initial: number
}

const readRange = (input: Locator): Promise<Range> =>
  input.evaluate((el) => {
    if (!(el instanceof HTMLInputElement)) throw new Error("not an input")
    return { min: Number(el.min), max: Number(el.max), step: Number(el.step), initial: Number(el.value) }
  })

// Points across a range, on its step grid: both ends and evenly spaced values between.
const sweep = (r: Range, points = 7): Array<number> => {
  const snap = (v: number) =>
    Math.min(r.max, Math.max(r.min, r.min + Math.round((v - r.min) / r.step) * r.step))
  const out = new Set<number>()
  for (let i = 0; i < points; i++)
    out.add(Number(snap(r.min + ((r.max - r.min) * i) / (points - 1)).toFixed(6)))
  return [...out]
}

const audit = async (page: Page, section: string, ctx: string): Promise<Array<string>> => {
  // Let React commit the new values before measuring.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  return page.evaluate(auditSvgs, { selector: `#section-${section} svg`, ctx })
}

/** Sweeps every slider of a widget section across its range and audits its SVGs at each value. */
const auditSliders = async (
  page: Page,
  section: string,
): Promise<{ issues: Array<string>; runs: number }> => {
  const inputs = page.locator(`.lsn #section-${section} input[type="range"]`)
  const count = await inputs.count()
  const ranges: Array<Range> = []
  for (let i = 0; i < count; i++) ranges.push(await readRange(inputs.nth(i)))
  const issues: Array<string> = []
  let runs = 0
  const resetAll = async () => {
    for (const [i, r] of ranges.entries()) await setRange(inputs.nth(i), r.initial)
  }

  issues.push(...(await audit(page, section, `${section} initial`)))
  runs++
  // One slider at a time across its range, the others at their defaults.
  for (const [i, r] of ranges.entries()) {
    for (const v of sweep(r)) {
      await setRange(inputs.nth(i), v)
      issues.push(...(await audit(page, section, `${section} param${i}=${v}`)))
      runs++
    }
    await setRange(inputs.nth(i), r.initial)
  }
  // Every corner: all sliders at their min or max together.
  for (let mask = 0; mask < 2 ** ranges.length; mask++) {
    const label: Array<string> = []
    for (const [i, r] of ranges.entries()) {
      const v = mask & (1 << i) ? r.max : r.min
      await setRange(inputs.nth(i), v)
      label.push(String(v))
    }
    issues.push(...(await audit(page, section, `${section} corner ${label.join(",")}`)))
    runs++
  }
  await resetAll()
  return { issues: [...new Set(issues)], runs }
}

test.describe("overlap audit of the guide's widgets", () => {
  test("plot: no overlaps across every slider's range", async ({ page }) => {
    await openGuide(page)
    const plot = page.locator(".lsn #section-plot")
    await plot.scrollIntoViewIfNeeded()
    await expect(plot.locator("svg.lsn-plot-svg")).toBeVisible()
    await expect(plot.locator('input[type="range"]')).not.toHaveCount(0)
    const { issues, runs } = await auditSliders(page, "plot")
    expect(runs).toBeGreaterThan(10)
    expect(issues).toEqual([])
  })

  test("graph (React Flow): no overlapping nodes, labels or edges", async ({ page }) => {
    await openGuide(page)
    const graph = page.locator(".lsn #section-graph")
    await graph.scrollIntoViewIfNeeded()
    const flow = graph.locator(".react-flow")
    await expect(flow.locator(".react-flow__node").first()).toBeVisible()
    // fitView runs after React Flow has measured the nodes: wait until the viewport stops moving.
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
    const issues = [
      ...(await page.evaluate(auditFlow, { selector: "#section-graph .react-flow", ctx: "graph" })),
      ...(await audit(page, "graph", "graph")),
    ]
    expect(issues).toEqual([])
  })

  test("incline (if the guide has one): no overlaps across its sliders", async ({ page }) => {
    await openGuide(page)
    const sections = await page
      .locator(".lsn section[id^='section-']")
      .evaluateAll((els) =>
        els
          .filter((e) => e.querySelector(".lsn-incline, svg.lsn-incline-svg") !== null)
          .map((e) => e.id.slice(8)),
      )
    test.skip(sections.length === 0, "the guide has no incline widget")
    for (const section of sections) {
      const { issues } = await auditSliders(page, section)
      expect(issues).toEqual([])
    }
  })
})
