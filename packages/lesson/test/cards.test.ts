import type { LessonSpec } from "@app/domain"
import { describe, expect, it } from "vitest"
import { cardChildren, resolveTarget } from "../src/index.ts"
import { concepts, guide } from "./fixtures.ts"

describe("drill-down", () => {
  const spec = guide("en")

  it("a card's children are the card links in its text", () => {
    expect(cardChildren({ k: "card", id: "f_card" }, spec, concepts)).toEqual([
      { k: "card", id: "avg_speed" },
      { k: "card", id: "total_time" },
    ])
    expect(cardChildren({ k: "card", id: "f_community" }, spec, concepts)).toEqual([
      { k: "card", id: "category" },
      { k: "card", id: "tag" },
      { k: "card", id: "fork" },
    ])
  })

  it("a part's children are the card links in its body", () => {
    expect(cardChildren({ k: "part", id: "t2" }, spec, concepts)).toEqual([{ k: "card", id: "hidden_given" }])
  })

  it("a shared concept's needs are children, through the lesson's own card when there is one", () => {
    expect(cardChildren({ k: "card", id: "avg_speed" }, spec, concepts)).toEqual([
      { k: "card", id: "total_time" },
    ])
    expect(cardChildren({ k: "card", id: "mean_speed" }, spec, concepts)).toEqual([
      { k: "card", id: "avg_speed" },
    ])
  })

  it("a need the lesson has no card for opens the concept itself", () => {
    const { total_time: _, ...cards } = spec.cards
    const without: LessonSpec = { ...spec, cards }
    const kids = cardChildren({ k: "card", id: "avg_speed" }, without, concepts)
    expect(kids).toEqual([{ k: "concept", slug: "physics.total-time" }])
    const r = resolveTarget({ k: "concept", slug: "physics.total-time" }, without, concepts)
    expect(r.k === "concept" && r.card.title).toBe("Total time")
  })

  it("resolves concepts in the lesson's language", () => {
    const r = resolveTarget({ k: "card", id: "avg_speed" }, guide("th"), concepts)
    expect(r.k).toBe("concept")
    expect(r.k === "concept" && r.card.title).toBe("อัตราเร็วเฉลี่ย")
    expect(r.k === "concept" && r.pinned.useCount).toBe(3)
  })

  it("unknown cards resolve as missing and have no children", () => {
    expect(resolveTarget({ k: "card", id: "nope" }, spec, concepts).k).toBe("missing")
    expect(cardChildren({ k: "card", id: "nope" }, spec, concepts)).toEqual([])
  })
})
