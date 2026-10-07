import { Result } from "effect"
import { describe, expect, it } from "vitest"
import {
  type ConceptSpec,
  checkLesson,
  compareConceptTranslations,
  compareTranslations,
  decodeConcept,
  decodeLesson,
  type Issue,
  type LessonSpec,
  lessonJsonSchema,
  validateConcept,
  validateConceptGraph,
  validateLesson,
} from "../src/index.ts"

// A small lesson that uses every reference kind once. Tests break one thing at a time.
const base = () => ({
  schema: 1,
  kind: "solve",
  lang: "en",
  title: "Trip",
  summary: "s",
  parts: {
    d: { label: "$d$", role: "given", color: "orange", meaning: "distance" },
    t: { label: "$t$", role: "given", color: "yellow", meaning: "time", body: "see {avg|average}" },
    v: { label: "$v$", role: "goal", color: "blue", meaning: "speed" },
  },
  cards: {
    avg: { concept: "physics.average-speed" },
    note: { kind: "term", title: "Note", body: "uses [d:distance] and $\\p{t}{t}$" },
  },
  sections: [
    { id: "intro", type: "text", body: "Find [v:speed] from {note|the note}." },
    { id: "pre", type: "concept", concept: "c", field: "f", prerequisites: ["avg"] },
    {
      id: "chain",
      type: "chain",
      steps: [
        {
          id: "s1",
          move: "divide",
          formula: "\\p{v}{v} = \\p{d}{d} / \\p{t}{t}",
          why: "def",
          uses: ["v", "d", "t"],
        },
      ],
    },
    {
      id: "proof",
      type: "proof",
      goal: "g",
      lines: [
        { id: "l1", claim: "a", why: "b", deps: [] },
        { id: "l2", claim: "c", why: "d", deps: ["l1"] },
      ],
    },
    {
      id: "graph",
      type: "graph",
      nodes: [
        { id: "n_v", label: "v", kind: "goal", needs: ["n_d"], part: "v" },
        { id: "n_d", label: "d", kind: "part", needs: [], card: "note" },
      ],
    },
    {
      id: "plot",
      type: "visual",
      widget: {
        kind: "plot",
        x: { min: 0, max: 4 },
        y: { min: 0, max: 200 },
        params: [
          { id: "d", label: "[d:$d$]", min: 0, max: 200, step: 10, value: 120, part: "d" },
          { id: "t", label: "[t:$t$]", min: 0.5, max: 3, step: 0.5, value: 2, part: "t" },
        ],
        curves: [{ expr: "d / t * x", part: "v" }],
        points: [{ x: "t", y: "d", part: "d" }],
        readouts: [{ label: "[v:$v$]", expr: "d / t", unit: "km/h", part: "v" }],
      },
    },
    {
      id: "flow",
      type: "visual",
      widget: {
        kind: "flow",
        nodes: [
          { id: "a", label: "A", part: "d" },
          { id: "b", label: "B", card: "note" },
        ],
        edges: [{ from: "a", to: "b" }],
      },
    },
    {
      id: "trace",
      type: "visual",
      widget: {
        kind: "trace",
        code: "a = 1\nb = 2",
        lang: "py",
        steps: [{ line: 2, note: "n", state: { a: "1" } }],
      },
    },
    {
      id: "recall",
      type: "recall",
      questions: [{ id: "q1", q: "?", options: ["a", "b"], answer: 1, why: "w" }],
    },
  ],
})

type Draft = ReturnType<typeof base>

const decode = (json: unknown): LessonSpec => {
  const r = decodeLesson(json)
  if (Result.isFailure(r)) throw new Error(r.failure.message)
  return r.success
}

const exists = (slug: string) => slug === "physics.average-speed"
const issues = (edit: (d: Draft) => void = () => {}): ReadonlyArray<Issue> => {
  const draft = base()
  edit(draft)
  return validateLesson(decode(draft), { resolveConcept: exists })
}
const codes = (list: ReadonlyArray<Issue>) => list.map((i) => `${i.code} ${i.path}`)

// Typed access to one section of the draft by index, for edits.
// biome-ignore lint/suspicious/noExplicitAny: test edits poke into a union of section shapes
const sec = (d: Draft, i: number): any => d.sections[i]

describe("validateLesson", () => {
  it("accepts a lesson whose references all resolve", () => {
    expect(issues()).toEqual([])
  })

  it("finds broken rich links, \\p refs and card links", () => {
    expect(
      codes(
        issues((d) => {
          d.parts.t.body = "see {nope|x}"
          d.cards.note.body = "[zz:x] $\\p{qq}{q}$"
          sec(d, 0).body = "[v:ok] {note|ok}"
        }),
      ),
    ).toEqual(["unknown_card parts.t.body", "unknown_part cards.note.body", "unknown_part cards.note.body"])
  })

  it("finds broken refs in TeX formulas and step uses", () => {
    expect(
      codes(
        issues((d) => {
          sec(d, 2).steps[0].formula = "\\p{w}{w}"
          sec(d, 2).steps[0].uses = ["v", "w"]
        }),
      ),
    ).toEqual(["unknown_part sections[2].steps[0].formula", "unknown_part sections[2].steps[0].uses[1]"])
  })

  it("checks concept prerequisites and concept card entries", () => {
    expect(
      codes(
        issues((d) => {
          sec(d, 1).prerequisites = ["avg", "gone"]
          d.cards.avg = { concept: "physics.unknown@2" }
        }),
      ),
    ).toEqual(["unknown_concept cards.avg.concept", "unknown_card sections[1].prerequisites[1]"])
  })

  it("checks proof deps: known and earlier", () => {
    expect(
      codes(
        issues((d) => {
          sec(d, 3).lines[0].deps = ["l2"]
          sec(d, 3).lines[1].deps = ["l1", "l9", "l2"]
        }),
      ),
    ).toEqual([
      "forward_dep sections[3].lines[0].deps[0]",
      "unknown_ref sections[3].lines[1].deps[1]",
      "forward_dep sections[3].lines[1].deps[2]",
    ])
  })

  it("checks graph needs, bindings and cycles", () => {
    const list = issues((d) => {
      sec(d, 4).nodes[1].needs = ["n_v", "n_x"]
      sec(d, 4).nodes[1].card = "nocard"
      sec(d, 4).nodes[0].part = "nopart"
    })
    expect(codes(list)).toEqual([
      "unknown_part sections[4].nodes[0].part",
      "unknown_ref sections[4].nodes[1].needs[1]",
      "unknown_card sections[4].nodes[1].card",
      "cycle sections[4].nodes",
    ])
    expect(list[3]?.message).toContain("n_v → n_d → n_v")
  })

  it("checks plot expressions, variables, ranges and bindings", () => {
    const list = issues((d) => {
      const w = sec(d, 5).widget
      w.curves[0].expr = "d / t * x * k"
      w.curves.push({ expr: "d +", part: "ghost" })
      w.points[0].x = "x"
      w.readouts[0].expr = "sin"
      w.params[1].value = 9
      w.params[1].step = 0
      w.params.push({ id: "pi", label: "p", min: 1, max: 0, step: 1, value: 1 })
      w.y = { min: 5, max: 5 }
    })
    expect(codes(list)).toEqual([
      "bad_range sections[5].widget.y",
      "bad_range sections[5].widget.params[1].step",
      "bad_range sections[5].widget.params[1].value",
      "bad_id sections[5].widget.params[2].id",
      "bad_range sections[5].widget.params[2]",
      "bad_range sections[5].widget.params[2].value",
      "unknown_var sections[5].widget.curves[0].expr",
      "bad_expr sections[5].widget.curves[1].expr",
      "unknown_part sections[5].widget.curves[1].part",
      "unknown_var sections[5].widget.points[0].x",
      "bad_expr sections[5].widget.readouts[0].expr",
    ])
  })

  it("checks flow edges and bindings, trace lines, recall answers", () => {
    expect(
      codes(
        issues((d) => {
          sec(d, 6).widget.edges.push({ from: "a", to: "zz", part: "nopart" })
          sec(d, 6).widget.nodes.push({ id: "a", label: "dup" })
          sec(d, 7).widget.steps[0].line = 3
          sec(d, 8).questions[0].answer = 2
        }),
      ),
    ).toEqual([
      "duplicate_id sections[6].widget.nodes[2].id",
      "unknown_ref sections[6].widget.edges[1].to",
      "unknown_part sections[6].widget.edges[1].part",
      "bad_range sections[7].widget.steps[0].line",
      "bad_range sections[8].questions[0].answer",
    ])
  })

  it("checks record-key ids and duplicate section / item ids", () => {
    expect(
      codes(
        issues((d) => {
          ;(d.parts as Record<string, unknown>).Bad = {
            label: "x",
            role: "given",
            color: "red",
            meaning: "m",
          }
          sec(d, 1).id = "intro"
          sec(d, 3).lines[1].id = "l1"
          sec(d, 3).lines[1].deps = []
        }),
      ),
    ).toEqual(["bad_id parts.Bad", "duplicate_id sections[1].id", "duplicate_id sections[3].lines[1].id"])
  })

  it("skips concept resolution without a resolver", () => {
    const d = base()
    d.cards.avg = { concept: "physics.unknown" }
    expect(validateLesson(decode(d))).toEqual([])
  })
})

describe("decoding", () => {
  it("rejects unknown keys and bad ids", () => {
    const typo = base() as Record<string, unknown>
    typo.problme = "x"
    expect(Result.isFailure(decodeLesson(typo))).toBe(true)
    const badId = base()
    sec(badId, 0).id = "Intro"
    expect(Result.isFailure(decodeLesson(badId))).toBe(true)
  })

  it("checkLesson reports schema errors as one issue", () => {
    const r = checkLesson({ schema: 2 })
    expect(r.spec).toBeUndefined()
    expect(r.issues[0]?.code).toBe("schema")
    expect(checkLesson(base(), { resolveConcept: exists }).issues).toEqual([])
  })

  it("exports a JSON Schema with id patterns and closed objects", () => {
    const doc = lessonJsonSchema()
    const text = JSON.stringify(doc)
    expect(doc.dialect).toBe("draft-2020-12")
    expect(text).toContain('"pattern":"^[a-z][a-z0-9_]{0,31}$"')
    expect(text).toContain('"additionalProperties":false')
  })
})

describe("compareTranslations", () => {
  const th = () => {
    const d = base()
    d.lang = "th"
    d.title = "การเดินทาง"
    sec(d, 0).body = "หา [v:อัตราเร็ว] จาก {note|โน้ต}"
    sec(d, 5).widget.readouts[0].unit = "กม./ชม."
    return d
  }

  it("accepts a translation that changes only prose", () => {
    expect(compareTranslations(decode(base()), decode(th()))).toEqual([])
  })

  it("finds differing ids, roles, structure and links", () => {
    const d = th()
    d.parts.v.color = "red"
    ;(d.cards as Record<string, unknown>).extra = { kind: "term", title: "x", body: "y" }
    sec(d, 2).steps[0].uses = ["v", "d"]
    sec(d, 8).questions[0].answer = 0
    expect(codes(compareTranslations(decode(base()), decode(d)))).toEqual([
      "parity parts.v",
      "parity cards",
      "parity sections[2]",
      "parity sections[8]",
    ])
  })

  it("finds a dropped link when the structure matches", () => {
    const d = th()
    sec(d, 0).body = "หา อัตราเร็ว จาก {note|โน้ต}"
    expect(codes(compareTranslations(decode(base()), decode(d)))).toEqual(["parity sections[0].body"])
  })

  it("finds reordered sections", () => {
    const d = th()
    d.sections.reverse()
    expect(codes(compareTranslations(decode(base()), decode(d)))).toEqual(["parity sections"])
  })
})

describe("concepts", () => {
  const concept = (slug: string, needs: Array<string>, lang: "en" | "th" = "en"): ConceptSpec => {
    const r = decodeConcept({
      schema: 1,
      slug,
      lang,
      card: { kind: "term", title: slug, body: "b" },
      needs,
      aliases: [],
    })
    if (Result.isFailure(r)) throw new Error(r.failure.message)
    return r.success
  }

  it("accepts a resolving, acyclic graph", () => {
    expect(validateConceptGraph([concept("a.x", []), concept("a.y", ["a.x"])])).toEqual([])
  })

  it("finds missing needs, unless resolved elsewhere", () => {
    const set = [concept("a.y", ["a.x"])]
    expect(codes(validateConceptGraph(set))).toEqual(["unknown_concept a.y.needs[0]"])
    expect(validateConceptGraph(set, (s) => s === "a.x")).toEqual([])
  })

  it("finds cycles", () => {
    const list = validateConceptGraph([
      concept("a.x", ["a.z"]),
      concept("a.y", ["a.x"]),
      concept("a.z", ["a.y"]),
    ])
    expect(codes(list)).toEqual(["cycle a.x.needs"])
    expect(list[0]?.message).toContain("a.x → a.z → a.y → a.x")
  })

  it("rejects links, self-needs and duplicate needs in one concept", () => {
    const c = concept("a.x", ["a.x", "a.y", "a.y"])
    const linked = { ...c, card: { ...c.card, body: "[d:x] {c|y} $\\p{t}{t}$" } }
    expect(codes(validateConcept(linked))).toEqual([
      "not_allowed card.body",
      "not_allowed card.body",
      "not_allowed card.body",
      "cycle needs[0]",
      "duplicate_id needs[2]",
    ])
  })

  it("compares concept translations", () => {
    expect(compareConceptTranslations(concept("a.x", ["a.y"]), concept("a.x", ["a.y"], "th"))).toEqual([])
    expect(codes(compareConceptTranslations(concept("a.x", ["a.y"]), concept("a.x", [], "th")))).toEqual([
      "parity needs",
    ])
  })
})
