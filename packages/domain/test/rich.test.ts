import { describe, expect, it } from "vitest"
import { parseRef, parseRich, parseRichBlocks, richPlainText, richRefs, texPartIds } from "../src/index.ts"

const text = (t: string) => ({ type: "text", text: t })

describe("parseRich", () => {
  it("reads plain text as one text node", () => {
    expect(parseRich("hello world")).toEqual([text("hello world")])
    expect(parseRich("")).toEqual([])
  })

  it("reads part links with markup in the label", () => {
    expect(parseRich("A [d:$d$ = 120 **km**].")).toEqual([
      text("A "),
      {
        type: "part",
        id: "d",
        children: [
          { type: "math", tex: "d", display: false },
          text(" = 120 "),
          { type: "strong", children: [text("km")] },
        ],
      },
      text("."),
    ])
  })

  it("reads card links", () => {
    expect(parseRich("see {avg_speed|average speed}")).toEqual([
      text("see "),
      { type: "card", id: "avg_speed", children: [text("average speed")] },
    ])
  })

  it("keeps brackets inside math in a label", () => {
    expect(parseRich("[iv:$[0, 1]$ interval]")).toEqual([
      {
        type: "part",
        id: "iv",
        children: [{ type: "math", tex: "[0, 1]", display: false }, text(" interval")],
      },
    ])
    expect(parseRich("{frac|$\\frac{a}{b}$}")).toEqual([
      { type: "card", id: "frac", children: [{ type: "math", tex: "\\frac{a}{b}", display: false }] },
    ])
  })

  it("allows nested brackets of the same kind in a label", () => {
    expect(parseRich("[a:x [y] z]")).toEqual([{ type: "part", id: "a", children: [text("x [y] z")] }])
  })

  it("reads inline and display math", () => {
    expect(parseRich("$a$ and $$b + c$$")).toEqual([
      { type: "math", tex: "a", display: false },
      text(" and "),
      { type: "math", tex: "b + c", display: true },
    ])
  })

  it("does not close math at an escaped dollar", () => {
    expect(parseRich("$5\\$ + x$")).toEqual([{ type: "math", tex: "5\\$ + x", display: false }])
  })

  it("reads bold, italic and code", () => {
    expect(parseRich("**b** *i* `c`")).toEqual([
      { type: "strong", children: [text("b")] },
      text(" "),
      { type: "em", children: [text("i")] },
      text(" "),
      { type: "code", text: "c" },
    ])
    expect(parseRich("*a **b** c*")).toEqual([
      { type: "em", children: [text("a "), { type: "strong", children: [text("b")] }, text(" c")] },
    ])
  })

  it("keeps code verbatim, including @refs and markup", () => {
    expect(parseRich("`@guide/chain.s2` and `[d:x]`")).toEqual([
      { type: "code", text: "@guide/chain.s2" },
      text(" and "),
      { type: "code", text: "[d:x]" },
    ])
  })

  it("treats escapes as literal characters", () => {
    expect(parseRich("costs \\$5, \\*not italic\\*, \\[d:no\\]")).toEqual([
      text("costs $5, *not italic*, [d:no]"),
    ])
    expect(parseRich("a \\ b \\n")).toEqual([text("a \\ b \\n")])
  })

  it("treats unmatched delimiters as text", () => {
    expect(parseRich("price $5")).toEqual([text("price $5")])
    expect(parseRich("$$ open")).toEqual([text("$$ open")])
    expect(parseRich("**open")).toEqual([text("**open")])
    expect(parseRich("2 * 3 * 4")).toEqual([text("2 * 3 * 4")])
    expect(parseRich("[d:open")).toEqual([text("[d:open")])
    expect(parseRich("{c|open")).toEqual([text("{c|open")])
    expect(parseRich("`open")).toEqual([text("`open")])
    expect(parseRich("$$")).toEqual([text("$$")])
    expect(parseRich("$ $")).toEqual([text("$ $")])
  })

  it("only links ids that match the id pattern", () => {
    expect(parseRich("[Upper:x] [1a:x] [a b:x] {A|x} [ok:x]")).toEqual([
      text("[Upper:x] [1a:x] [a b:x] {A|x} "),
      { type: "part", id: "ok", children: [text("x")] },
    ])
    expect(parseRich(`[${"a".repeat(33)}:x]`)).toEqual([text(`[${"a".repeat(33)}:x]`)])
  })

  it("does not nest links", () => {
    expect(parseRich("[a:see {c|card}]")).toEqual([
      { type: "part", id: "a", children: [text("see {c|card}")] },
    ])
  })

  it("reads Thai text and keeps HTML as text", () => {
    expect(parseRich("เวลา[tt:รวม] <b>x</b>")).toEqual([
      text("เวลา"),
      { type: "part", id: "tt", children: [text("รวม")] },
      text(" <b>x</b>"),
    ])
  })

  it("never throws on random input", () => {
    const alphabet = ["$", "$$", "*", "**", "[", "]", "{", "}", "|", ":", "\\", "`", "a", "d", " ", "\n", "p"]
    let seed = 42
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed / 2 ** 31
    }
    for (let n = 0; n < 3000; n++) {
      const len = Math.floor(rand() * 40)
      let s = ""
      for (let k = 0; k < len; k++) s += alphabet[Math.floor(rand() * alphabet.length)]
      expect(() => parseRich(s)).not.toThrow()
      expect(() => parseRichBlocks(s)).not.toThrow()
    }
    expect(() => parseRich("[a:".repeat(2000))).not.toThrow()
    expect(() => parseRich("*a ".repeat(2000))).not.toThrow()
  })
})

describe("parseRichBlocks", () => {
  it("splits paragraphs at blank lines and keeps single newlines", () => {
    expect(parseRichBlocks("one\nline\n\ntwo [d:x]\n \n\nthree")).toEqual([
      [text("one\nline")],
      [text("two "), { type: "part", id: "d", children: [text("x")] }],
      [text("three")],
    ])
  })
})

describe("references", () => {
  it("collects part, card and \\p references", () => {
    expect(
      richRefs("[a:$\\p{b}{x}$] {c|y} $\\p{d}{T} = \\p{b}{t} + \\pi + \\phi$ {c|again} `[z:code]`"),
    ).toEqual({ parts: ["a"], cards: ["c"], texParts: ["b", "d"] })
  })

  it("extracts \\p ids from TeX and ignores \\pi, \\phi, \\pm", () => {
    expect(texPartIds("\\p{tt}{T} = \\p{t1}{t_1} + \\p { t2 }{t_2} \\pm \\pi \\phi")).toEqual([
      "tt",
      "t1",
      "t2",
    ])
    expect(texPartIds("x^2")).toEqual([])
  })

  it("gives plain text", () => {
    expect(richPlainText("A [d:$d$ km] and **{c|bold card}**")).toBe("A d km and bold card")
  })

  it("parses @refs", () => {
    expect(parseRef("@guide/chain.s2")).toEqual({ slug: "guide", section: "chain", item: "s2" })
    expect(parseRef("@thomae/c2")).toEqual({ slug: "thomae", section: "c2", item: undefined })
    expect(parseRef("guide/chain")).toBeUndefined()
    expect(parseRef("@Guide/chain")).toBeUndefined()
  })
})
