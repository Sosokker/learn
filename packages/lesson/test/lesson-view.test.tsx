import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { LessonView } from "../src/index.ts"
import { concepts, guide } from "./fixtures.ts"

afterEach(cleanup)

describe("LessonView", () => {
  it("renders every section of the guide", () => {
    const spec = guide("en")
    const { container } = render(<LessonView spec={spec} concepts={concepts} slug="guide" uiLang="en" />)
    for (const s of spec.sections)
      expect(container.querySelector(`section[data-ref="${s.id}"]`)).not.toBeNull()
    expect(container.querySelectorAll('[data-ref^="chain."]')).toHaveLength(3)
    expect(container.querySelector("article")?.getAttribute("lang")).toBe("en")
  })

  it("pins a card, drills into a child, and shows the shared-concept badge", () => {
    const { container } = render(
      <LessonView spec={guide("en")} concepts={concepts} slug="guide" uiLang="en" />,
    )
    const link = container.querySelector('#lx-concept button.lx-card[data-card="avg_speed"]')
    if (!(link instanceof HTMLElement)) throw new Error("no avg_speed link")
    fireEvent.click(link)
    const panel = container.querySelector(".lx-inspector")
    expect(panel?.querySelector(".lx-cardview-title")?.textContent).toBe("Average speed")
    expect(panel?.textContent).toContain("shared concept")
    expect(panel?.textContent).toContain("used by 3 lessons")
    const child = panel?.querySelector(".lx-tree-node.is-child")
    if (!(child instanceof HTMLElement)) throw new Error("no child in tree")
    fireEvent.click(child)
    expect(panel?.querySelector(".lx-cardview-title")?.textContent).toBe("Total time")
    expect([...(panel?.querySelectorAll(".lx-crumb-btn") ?? [])].map((b) => b.textContent)).toEqual([
      "Average speed",
      "Total time",
    ])
  })

  it("alt-click adds an @ref chip and the button builds the prompt", async () => {
    const asked: Array<string> = []
    const { container } = render(
      <LessonView
        spec={guide("en")}
        concepts={concepts}
        slug="guide"
        uiLang="en"
        onAsk={(p) => asked.push(p)}
      />,
    )
    const step = container.querySelector('[data-ref="chain.s2"] .lx-step-move')
    if (!(step instanceof HTMLElement)) throw new Error("no step")
    fireEvent.click(step, { altKey: true })
    expect(screen.getByText("@guide/chain.s2")).not.toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByText("Copy prompt for pi"))
    })
    expect(asked[0]).toContain("[@guide/chain.s2] Chain › Step 2")
  })

  it("hides answers in let-me-try mode until clicked", () => {
    const { container } = render(
      <LessonView spec={guide("en")} concepts={concepts} slug="guide" uiLang="th" initialTryMode />,
    )
    const step = container.querySelector('[data-ref="chain.s1"]')
    const buttons = step?.querySelectorAll(".lx-reveal-btn") ?? []
    expect(buttons).toHaveLength(2)
    const first = buttons[0]
    if (!(first instanceof HTMLElement)) throw new Error("no reveal")
    expect(first.textContent).toBe("คลิกเพื่อดู")
    fireEvent.click(first)
    expect(step?.querySelectorAll(".lx-reveal-btn")).toHaveLength(1)
  })
})
