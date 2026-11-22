import { describe, expect, it } from "vitest"
import {
  type ConceptPathNode,
  maxConceptPath,
  orderConceptPath,
  walkConceptPath,
} from "../src/concept-path.ts"

const graphOf = (entries: ReadonlyArray<readonly [string, ReadonlyArray<string>]>) =>
  new Map<string, ConceptPathNode>(entries.map(([slug, needs]) => [slug, { slug, needs }]))

const indexBySlug = (order: ReadonlyArray<ConceptPathNode>) =>
  new Map(order.map((node, index) => [node.slug, index]))

describe("orderConceptPath / walkConceptPath", () => {
  it("orders a linear prerequisite chain with prerequisites first and target last", () => {
    const graph = graphOf([
      ["physics.total-time", []],
      ["physics.average-speed", ["physics.total-time"]],
      ["physics.mean-speed-theorem", ["physics.average-speed"]],
    ])

    const result = orderConceptPath("physics.mean-speed-theorem", graph)
    expect(result.truncated).toBe(false)
    expect(result.order.map((n) => n.slug)).toEqual([
      "physics.total-time",
      "physics.average-speed",
      "physics.mean-speed-theorem",
    ])
    expect(result.edges).toEqual([
      { from: "physics.total-time", to: "physics.average-speed" },
      { from: "physics.average-speed", to: "physics.mean-speed-theorem" },
    ])
  })

  it("handles diamond dependencies without duplicates and respects every edge", async () => {
    // D -> B, C; B -> A; C -> A
    const graph = graphOf([
      ["physics.a", []],
      ["physics.b", ["physics.a"]],
      ["physics.c", ["physics.a"]],
      ["physics.d", ["physics.b", "physics.c"]],
    ])
    const fetched: Array<string> = []
    const result = await walkConceptPath("physics.d", async (slug) => {
      fetched.push(slug)
      return graph.get(slug)
    })

    const slugs = result.order.map((n) => n.slug)
    expect(result.truncated).toBe(false)
    // Every concept appears once and is fetched once.
    expect(new Set(slugs).size).toBe(4)
    expect(slugs).toHaveLength(4)
    expect(fetched).toHaveLength(4)
    // A before B and C; B and C before D.
    const pos = indexBySlug(result.order)
    expect(pos.get("physics.a")).toBeLessThan(pos.get("physics.b") ?? -1)
    expect(pos.get("physics.a")).toBeLessThan(pos.get("physics.c") ?? -1)
    expect(pos.get("physics.b")).toBeLessThan(pos.get("physics.d") ?? -1)
    expect(pos.get("physics.c")).toBeLessThan(pos.get("physics.d") ?? -1)
    expect(slugs.at(-1)).toBe("physics.d")
  })

  it("handles shared prerequisites across multiple branches and depths", () => {
    // target -> [left, right]; left -> [shared, base]; right -> [mid]; mid -> [shared]
    const graph = graphOf([
      ["physics.base", []],
      ["physics.shared", ["physics.base"]],
      ["physics.mid", ["physics.shared"]],
      ["physics.left", ["physics.shared", "physics.base"]],
      ["physics.right", ["physics.mid"]],
      ["physics.target", ["physics.left", "physics.right"]],
      ["physics.unrelated", []],
    ])

    const result = orderConceptPath("physics.target", graph)
    const slugs = result.order.map((n) => n.slug)
    expect(result.truncated).toBe(false)
    expect(slugs).not.toContain("physics.unrelated")
    expect(slugs).toHaveLength(6)
    expect(new Set(slugs).size).toBe(6)
    expect(slugs.at(-1)).toBe("physics.target")

    const pos = indexBySlug(result.order)
    for (const edge of result.edges) {
      expect(pos.get(edge.from)).toBeLessThan(pos.get(edge.to) ?? -1)
    }
  })

  it("caps the walk at maxConceptPath (64) and reports truncation", async () => {
    const entries: Array<readonly [string, ReadonlyArray<string>]> = []
    for (let i = 0; i < 80; i++) {
      const slug = `physics.c${String(i).padStart(2, "0")}`
      const needs = i === 0 ? [] : [`physics.c${String(i - 1).padStart(2, "0")}`]
      entries.push([slug, needs])
    }
    const graph = graphOf(entries)
    let calls = 0
    const result = await walkConceptPath("physics.c79", async (slug) => {
      calls += 1
      return graph.get(slug)
    })

    expect(maxConceptPath).toBe(64)
    expect(calls).toBe(64)
    expect(result.truncated).toBe(true)
    expect(result.order).toHaveLength(64)
    expect(result.order[0]?.slug).toBe("physics.c16")
    expect(result.order.at(-1)?.slug).toBe("physics.c79")
    const pos = indexBySlug(result.order)
    for (const edge of result.edges) {
      expect(pos.get(edge.from)).toBeLessThan(pos.get(edge.to) ?? -1)
    }
  })

  it("caps wide graphs when a frontier exceeds the remaining budget", async () => {
    const children = Array.from({ length: 10 }, (_, i) => `physics.n${i}`)
    const graph = graphOf([
      ["physics.root", children],
      ...children.map((slug) => [slug, [] as ReadonlyArray<string>] as const),
    ])
    let calls = 0
    const result = await walkConceptPath(
      "physics.root",
      async (slug) => {
        calls += 1
        return graph.get(slug)
      },
      5,
    )

    expect(calls).toBe(5)
    expect(result.truncated).toBe(true)
    expect(result.order).toHaveLength(5)
    expect(result.order.at(-1)?.slug).toBe("physics.root")
  })

  it("returns an empty path when the target concept does not exist", async () => {
    const result = await walkConceptPath("physics.missing", async () => undefined)
    expect(result).toEqual({ target: "physics.missing", order: [], edges: [], truncated: false })
  })
})
