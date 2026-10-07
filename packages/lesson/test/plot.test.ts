import { compileExpr } from "@app/domain"
import { describe, expect, it } from "vitest"
import { niceTicks, sampleCurve, segmentsToPath } from "../src/index.ts"

describe("sampleCurve", () => {
  it("breaks the path where the expression is not finite", () => {
    // ln(x) is NaN for x < 0 and -Infinity at 0, so only x > 0 is drawn.
    const segs = sampleCurve(compileExpr("ln(x)").fn, {}, -1, 1, 20)
    expect(segs).toHaveLength(1)
    expect(segs[0]?.every((p) => p.x > 0 && Number.isFinite(p.y))).toBe(true)
  })

  it("splits into separate segments around a pole", () => {
    const segs = sampleCurve(compileExpr("1 / (x - c)").fn, { c: 0.5 }, 0, 1, 4)
    // x = 0, 0.25 | 0.5 is ±Infinity | 0.75, 1
    expect(segs.map((s) => s.map((p) => p.x))).toEqual([
      [0, 0.25],
      [0.75, 1],
    ])
    const d = segmentsToPath(
      segs,
      (x) => x * 100,
      (y) => -y,
    )
    expect(d.match(/M/g)).toHaveLength(2)
  })

  it("reads params and x", () => {
    const segs = sampleCurve(compileExpr("d / (t1 + t2) * x").fn, { d: 120, t1: 1.5, t2: 0.5 }, 0, 2, 2)
    expect(segs[0]).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 60 },
      { x: 2, y: 120 },
    ])
  })

  it("survives an expression that throws", () => {
    const segs = sampleCurve(
      () => {
        throw new Error("boom")
      },
      {},
      0,
      1,
      4,
    )
    expect(segs).toEqual([])
  })
})

describe("niceTicks", () => {
  it("uses round steps", () => {
    expect(niceTicks(0, 220, 5)).toEqual([0, 50, 100, 150, 200])
    expect(niceTicks(0, 3.5, 7)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5])
  })
})
