import { describe, expect, it } from "vitest"
import { parseInline, parseRich, richRefs, richToPlain, texPartRefs, texToKatex } from "../src/index.ts"

describe("rich", () => {
  it("parses part and card links with math inside", () => {
    expect(parseInline("[v:$\\bar v$] is {avg|average}")).toEqual([
      { t: "part", id: "v", c: [{ t: "math", tex: "\\bar v", display: false }] },
      { t: "text", v: " is " },
      { t: "card", id: "avg", c: [{ t: "text", v: "average" }] },
    ])
  })

  it("does not end a label at a bracket inside math", () => {
    expect(parseInline("[x:$[0,1]$]")).toEqual([
      { t: "part", id: "x", c: [{ t: "math", tex: "[0,1]", display: false }] },
    ])
  })

  it("parses emphasis, code, display math and escaped dollars", () => {
    expect(parseInline("**a** *b* `c` $$d$$ \\$5")).toEqual([
      { t: "bold", c: [{ t: "text", v: "a" }] },
      { t: "text", v: " " },
      { t: "italic", c: [{ t: "text", v: "b" }] },
      { t: "text", v: " " },
      { t: "code", v: "c" },
      { t: "text", v: " " },
      { t: "math", tex: "d", display: true },
      { t: "text", v: " $5" },
    ])
  })

  it("leaves unmatched markup as text", () => {
    expect(parseInline("a [b] {c} 2 * 3 $x")).toEqual([{ t: "text", v: "a [b] {c} 2 * 3 $x" }])
    expect(parseInline("[Bad:x] {B|y}")).toEqual([{ t: "text", v: "[Bad:x] {B|y}" }])
  })

  it("splits paragraphs on blank lines", () => {
    expect(parseRich("a\n\nb\nc")).toEqual([
      [{ t: "text", v: "a" }],
      [{ t: "text", v: "b" }, { t: "br" }, { t: "text", v: "c" }],
    ])
  })

  it("collects references, including \\p{} in math", () => {
    expect(richRefs("[d:x] $\\p{tt}{T}$ {c|y} {e|[f:z]}")).toEqual({
      parts: ["d", "tt", "f"],
      cards: ["c", "e"],
    })
  })

  it("converts \\p{} to \\htmlData{}", () => {
    expect(texToKatex("\\p{tt}{T} = \\p{t1}{t_1}")).toBe("\\htmlData{part=tt}{T} = \\htmlData{part=t1}{t_1}")
    expect(texPartRefs("\\p{a}{x}+\\p{b_2}{y}")).toEqual(["a", "b_2"])
  })

  it("makes plain text", () => {
    expect(richToPlain("**Hi** [d:$d$], see {c|this}")).toBe("Hi d, see this")
  })
})
