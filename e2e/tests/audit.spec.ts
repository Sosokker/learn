import { expect, type Locator, test } from "@playwright/test"

// Widget overlap audit: drag every slider of every plot to min, middle and max, and check that no
// two labels in the SVG overlap and none leave the plot. Lessons are generated, so ranges an
// author never tried are exactly where labels collide.

type Box = { x: number; y: number; w: number; h: number; text: string }

async function labelBoxes(svg: Locator): Promise<{ boxes: Array<Box>; frame: Box }> {
  return svg.evaluate((el) => {
    const f = el.getBoundingClientRect()
    const boxes = [...el.querySelectorAll("text")]
      .filter((t) => (t.textContent ?? "").trim() !== "")
      .map((t) => {
        const r = t.getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height, text: t.textContent ?? "" }
      })
    return { boxes, frame: { x: f.x, y: f.y, w: f.width, h: f.height, text: "" } }
  })
}

const overlap = (a: Box, b: Box) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1

async function audit(svg: Locator, where: string) {
  const { boxes, frame } = await labelBoxes(svg)
  for (const b of boxes) {
    expect(
      b.x >= frame.x - 1 && b.x + b.w <= frame.x + frame.w + 1,
      `${where}: "${b.text}" leaves the plot`,
    ).toBe(true)
    expect(
      b.y >= frame.y - 1 && b.y + b.h <= frame.y + frame.h + 1,
      `${where}: "${b.text}" leaves the plot`,
    ).toBe(true)
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i] as Box
      const b = boxes[j] as Box
      expect(overlap(a, b), `${where}: "${a.text}" overlaps "${b.text}"`).toBe(false)
    }
}

for (const lang of ["en", "th"])
  test(`plots in the guide have no overlapping labels (${lang})`, async ({ page }) => {
    await page.goto(`/guide?lang=${lang}`)
    const plots = page.locator(".lx-plot")
    await expect(plots.first()).toBeVisible()
    for (let p = 0; p < (await plots.count()); p++) {
      const plot = plots.nth(p)
      await plot.scrollIntoViewIfNeeded()
      const svg = plot.locator(".lx-plot-box svg")
      await audit(svg, `plot ${p} initial`)
      const sliders = plot.locator('input[type="range"]')
      for (let s = 0; s < (await sliders.count()); s++) {
        const slider = sliders.nth(s)
        const [min, max, initial] = await slider.evaluate((el: HTMLInputElement) => [
          el.min,
          el.max,
          el.value,
        ])
        for (const v of [Number(min), (Number(min) + Number(max)) / 2, Number(max)]) {
          await slider.fill(String(v))
          await audit(svg, `plot ${p} slider ${s} = ${v}`)
        }
        await slider.fill(String(initial))
      }
    }
  })
