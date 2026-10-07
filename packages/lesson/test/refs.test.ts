import { describe, expect, it } from "vitest"
import { buildAskPrompt, richToPrompt } from "../src/index.ts"
import { concepts, guide } from "./fixtures.ts"

describe("buildAskPrompt", () => {
  const spec = guide("en")

  it("puts the question first, then a chain step as clean text with TeX kept as $…$", () => {
    const prompt = buildAskPrompt({
      question: "  Why T and not t1?  ",
      refs: ["chain.s2"],
      spec,
      concepts,
      slug: "guide",
      uiLang: "en",
    })
    expect(prompt).toBe(
      [
        "Why T and not t1?",
        "",
        'Context from the lesson "Start here: how Learn works" (@guide):',
        "",
        "[@guide/chain.s2] Chain › Step 2",
        "Move: Apply average speed",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: a TeX group right after the opening $
        "Formula: ${\\bar v} = \\dfrac{{d}}{{T}} = \\dfrac{120}{2} = 60\\ \\text{km/h}$",
        "Why: definition of average speed: total distance over total time.",
        "Uses: $\\bar v$ (average speed for the whole trip); $d$ (distance of the trip: 120 km); $T$ (total time of the trip: 2 h)",
      ].join("\n"),
    )
  })

  it("includes cards, shared concepts and whole sections, and skips unknown refs", () => {
    const prompt = buildAskPrompt({
      question: "",
      refs: ["cards.avg_speed", "trap.l4", "check", "nope.x"],
      spec,
      concepts,
      slug: "guide",
      uiLang: "en",
    })
    expect(prompt.startsWith("(no question yet)")).toBe(true)
    expect(prompt).toContain(
      "[@guide/cards.avg_speed] Average speed [formula, shared concept physics.average-speed]",
    )
    expect(prompt).toContain("$\\bar v = \\dfrac{\\text{total distance}}{\\text{total time}}$")
    expect(prompt).toContain("[@guide/trap.l4] The trap, proved › Line 4")
    expect(prompt).toContain("Uses: (1), (3)")
    expect(prompt).toContain("[@guide/check] Check\n- Units: km ÷ h = km/h ✓")
    expect(prompt).not.toContain("nope")
  })

  it("uses the UI language for labels", () => {
    const prompt = buildAskPrompt({
      question: "ทำไม",
      refs: ["chain.s1"],
      spec: guide("th"),
      concepts,
      slug: "guide",
      uiLang: "th",
    })
    expect(prompt).toContain("[@guide/chain.s1]")
    expect(prompt).toContain("สูตร: $")
  })
})

describe("richToPrompt", () => {
  it("keeps math delimiters and drops link markup", () => {
    expect(richToPrompt("see {c|the card} and [d:$d$] with $$x$$")).toBe("see the card and $d$ with $$x$$")
  })
})
