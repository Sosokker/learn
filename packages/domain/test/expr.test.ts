import { describe, expect, it } from "vitest"
import { compileExpr, ExprError } from "../src/index.ts"

const run = (src: string, vars: Record<string, number> = {}) => compileExpr(src).fn(vars)

describe("expr", () => {
  it("follows precedence", () => {
    expect(run("1 + 2 * 3")).toBe(7)
    expect(run("2 ^ 3 ^ 2")).toBe(512)
    expect(run("-2 ^ 2")).toBe(-4)
    expect(run("(1 + 2) * 3")).toBe(9)
    expect(run("10 / 4 - 1")).toBe(1.5)
    expect(run("1e3 + .5")).toBe(1000.5)
  })

  it("reads variables and calls functions", () => {
    expect(run("d * min(x, t1) / t1", { d: 120, x: 3, t1: 1.5 })).toBe(120)
    expect(run("sqrt(abs(x)) + max(1, 2, 3)", { x: -16 })).toBe(7)
    expect(run("sin(pi / 2) + ln(e)")).toBe(2)
    expect([...compileExpr("d / (t1 + t2) * x").vars].sort()).toEqual(["d", "t1", "t2", "x"])
  })

  it("is NaN for a missing variable, never a global", () => {
    expect(run("y")).toBeNaN()
    expect(run("constructor")).toBeNaN()
    expect(run("toString")).toBeNaN()
  })

  it("rejects bad input", () => {
    for (const bad of ["1 +", "foo(1)", "sin(1, 2)", "1 2", "a.b", "x[0]", "(1", "'a'", "x = 1"])
      expect(() => compileExpr(bad), bad).toThrow(ExprError)
  })
})
