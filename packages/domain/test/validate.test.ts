import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { LessonSpec, translationIssues, validateLesson } from "../src/index.ts"

const guide = Schema.decodeUnknownSync(LessonSpec)(
  JSON.parse(readFileSync(join(import.meta.dirname, "../../../content/guide/en.json"), "utf8")),
)
const messages = (spec: LessonSpec) => validateLesson(spec, { concepts: new Set() }).map((i) => i.message)
const withSection = (i: number, patch: object): LessonSpec => ({
  ...guide,
  sections: guide.sections.map((s, j) => (j === i ? ({ ...s, ...patch } as typeof s) : s)),
})
const idx = (id: string) => guide.sections.findIndex((s) => s.id === id)

describe("validateLesson", () => {
  it("reports unknown parts, cards and concepts", () => {
    const m = messages(withSection(idx("problem"), { body: "[zz:x] {yy|y} $\\p{ww}{w}$" }))
    expect(m).toContain('unknown part "zz"')
    expect(m).toContain('unknown card "yy"')
    expect(m).toContain('unknown part "ww"')
    expect(m).toContain('unknown concept "physics.average-speed"')
  })

  it("reports proof lines that use later lines, and graph cycles", () => {
    const proof = guide.sections[idx("trap")]
    if (proof?.type !== "proof") throw new Error("no proof")
    const lines = proof.lines.map((l) => (l.id === "l1" ? { ...l, deps: ["l2"] } : l))
    expect(messages(withSection(idx("trap"), { lines }))).toContain(
      'line "l2" comes later, a proof can only use earlier lines',
    )
    const graph = guide.sections[idx("graph")]
    if (graph?.type !== "graph") throw new Error("no graph")
    const nodes = graph.nodes.map((n) => (n.id === "n_d" ? { ...n, needs: ["n_v"] } : n))
    expect(
      messages(withSection(idx("graph"), { nodes })).some((m) => m.startsWith("graph has a cycle")),
    ).toBe(true)
  })

  it("reports expressions that read unknown variables", () => {
    const plot = guide.sections[idx("plot")]
    if (plot?.type !== "visual" || plot.widget.kind !== "plot") throw new Error("no plot")
    const widget = { ...plot.widget, curves: [{ expr: "q * x" }, { expr: "1 +" }] }
    const m = messages(withSection(idx("plot"), { widget }))
    expect(m).toContain('unknown variable "q" in "q * x"')
    expect(m.some((x) => x.startsWith('bad expression "1 +"'))).toBe(true)
  })

  it("reports translations whose ids differ", () => {
    const th = { ...guide, lang: "th" as const, parts: { ...guide.parts, extra: guide.parts.d as never } }
    expect(translationIssues(guide, th)).toEqual([{ path: "part:extra", message: "missing in en" }])
  })
})
