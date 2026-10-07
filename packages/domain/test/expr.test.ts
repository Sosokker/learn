import { Result } from "effect"
import { describe, expect, it } from "vitest"
import { compile, evaluate, freeVars, isReservedName, parseExpr } from "../src/index.ts"

const value = (src: string, vars: Record<string, number> = {}) => {
  const r = evaluate(src, vars)
  if (Result.isFailure(r)) throw new Error(r.failure.message)
  return r.success
}

const error = (src: string) => {
  const r = parseExpr(src)
  if (Result.isSuccess(r)) throw new Error(`expected "${src}" to fail`)
  return r.failure
}

describe("parseExpr / evaluate", () => {
  it("does arithmetic with precedence", () => {
    expect(value("1 + 2 * 3")).toBe(7)
    expect(value("(1 + 2) * 3")).toBe(9)
    expect(value("10 - 4 - 3")).toBe(3)
    expect(value("12 / 3 / 2")).toBe(2)
    expect(value("2 ^ 3 ^ 2")).toBe(512)
    expect(value("-2 ^ 2")).toBe(-4)
    expect(value("2 ^ -1")).toBe(0.5)
    expect(value("--3 + +1")).toBe(4)
  })

  it("reads number forms", () => {
    expect(value("1.5 + .5 + 2.")).toBe(4)
    expect(value("1e3 + 2.5E-1")).toBe(1000.25)
  })

  it("uses variables and constants", () => {
    expect(value("d / (t1 + t2) * x", { d: 120, t1: 1.5, t2: 0.5, x: 1 })).toBe(60)
    expect(value("pi")).toBe(Math.PI)
    expect(value("e")).toBe(Math.E)
    expect(Number.isNaN(value("missing + 1"))).toBe(true)
    expect(Number.isNaN(value("constructor"))).toBe(true)
  })

  it("calls functions", () => {
    expect(value("sin(0) + cos(0)")).toBe(1)
    expect(value("sqrt(16) + abs(-2)")).toBe(6)
    expect(value("ln(e) + log(100) + exp(0)")).toBe(4)
    expect(value("min(3, 1, 2) + max(3, 1, 2)")).toBe(4)
    expect(value("pow(2, 10)")).toBe(1024)
    expect(value("floor(1.7) + ceil(1.2) + round(2.5)")).toBe(6)
    expect(value("mod(-1, 3)")).toBe(2)
    expect(value("d * min(x, t1) / t1", { d: 120, t1: 1.5, x: 3 })).toBe(120)
  })

  it("compiles once and runs many times", () => {
    const f = compile("a * x ^ 2")
    if (Result.isFailure(f)) throw new Error("compile failed")
    expect([0, 1, 2].map((x) => f.success({ a: 3, x }))).toEqual([0, 3, 12])
  })

  it("lists free variables without constants or functions", () => {
    const ast = parseExpr("d * min(x, t1) / t1 + pi * e + sin(theta)")
    if (Result.isFailure(ast)) throw new Error("parse failed")
    expect(freeVars(ast.success)).toEqual(["d", "t1", "theta", "x"])
  })

  it("returns typed errors with an offset, never throws", () => {
    expect(error("")).toMatchObject({ _tag: "ExprError", at: 0 })
    expect(error("   ")).toMatchObject({ reason: "expression is empty" })
    expect(error("1 +")).toMatchObject({ at: 3 })
    expect(error("2 +* 3")).toMatchObject({ at: 3 })
    expect(error("(1 + 2")).toMatchObject({ at: 6 })
    expect(error("1 + 2)")).toMatchObject({ at: 5 })
    expect(error("2x")).toMatchObject({ at: 1 })
    expect(error("a.b")).toMatchObject({ at: 1 })
    expect(error("alert(1)").reason).toContain("unknown function")
    expect(error("sin").reason).toContain("needs arguments")
    expect(error("sin(1, 2)").reason).toContain("takes 1 argument")
    expect(error("pow(1)").reason).toContain("takes 2 argument")
    expect(error("max()").reason).toContain("takes 1 to 16")
    expect(error("x = 1").reason).toContain('"="')
    expect(error("1 + 2)").message).toContain('in "1 + 2)"')
    expect(error("(".repeat(500)).reason).toContain("nested too deeply")
    expect(error("1".repeat(1001)).reason).toContain("longer than")
  })

  it("marks reserved names", () => {
    expect(["pi", "e", "sin", "min"].every(isReservedName)).toBe(true)
    expect(["x", "d", "t1", "constructor", "toString"].some(isReservedName)).toBe(false)
  })
})
