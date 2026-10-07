import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Rich } from "../src/index.ts"

afterEach(cleanup)

describe("Rich", () => {
  it("renders part links, card links, math and emphasis", () => {
    const { container } = render(
      <Rich
        src={"Hover [d:$d$ = 120 km], open {avg_speed|average speed}, see **bold** *it* `code` $x^2$."}
      />,
    )
    const part = container.querySelector('button.lx-part[data-part="d"]')
    expect(part?.querySelector(".katex")).not.toBeNull()
    expect(part?.textContent).toContain("120 km")
    const card = container.querySelector('button.lx-card[data-card="avg_speed"]')
    expect(card?.textContent).toBe("average speed")
    expect(container.querySelector("strong")?.textContent).toBe("bold")
    expect(container.querySelector("em")?.textContent).toBe("it")
    expect(container.querySelector("code")?.textContent).toBe("code")
    expect(container.querySelectorAll(".katex")).toHaveLength(2)
  })

  it("turns \\p{part}{…} in TeX into a data-part element", () => {
    const { container } = render(<Rich src={"$\\p{v}{\\bar v} = \\p{d}{d} / T$"} />)
    expect(container.querySelector('.katex [data-part="v"]')).not.toBeNull()
    expect(container.querySelector('.katex [data-part="d"]')).not.toBeNull()
  })

  it("never turns lesson text into HTML", () => {
    const src = '<img src=x onerror="alert(1)"> [d:<b>x</b>] {c|<script>alert(2)</script>}'
    const { container } = render(<Rich src={src} />)
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector("b")).toBeNull()
    expect(container.querySelector("script")).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">')
    expect(container.textContent).toContain("<script>alert(2)</script>")
  })

  it("only trusts \\htmlData inside math", () => {
    const { container } = render(<Rich src={"$\\href{javascript:alert(1)}{x} \\htmlClass{evil}{y}$"} />)
    expect(container.querySelector("a")).toBeNull()
    expect(container.querySelector(".evil")).toBeNull()
  })

  it("splits paragraphs and keeps a stray bracket as text", () => {
    const { container } = render(<Rich src={"one [not a link\n\ntwo"} />)
    const ps = container.querySelectorAll("p")
    expect(ps).toHaveLength(2)
    expect(ps[0]?.textContent).toBe("one [not a link")
  })
})
