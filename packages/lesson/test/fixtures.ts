// Fixtures: the real guide + concepts from content/, and a small lesson that covers the section
// and widget types the guide does not use (units, flow, incline, trace).

import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { type ConceptSpec, checkConcept, checkLesson, type LessonSpec } from "@app/domain"

const content = fileURLToPath(new URL("../../../content/", import.meta.url))
const readJson = (path: string): unknown => JSON.parse(readFileSync(`${content}${path}`, "utf8"))

export const loadGuide = (lang: "en" | "th"): LessonSpec => {
  const { spec, issues } = checkLesson(readJson(`guide/${lang}.json`))
  if (spec === undefined || issues.length > 0)
    throw new Error(`guide/${lang}.json: ${JSON.stringify(issues)}`)
  return spec
}

export const loadConcepts = (): ReadonlyArray<ConceptSpec> =>
  readdirSync(`${content}concepts`, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) =>
      (["en", "th"] as const).map((lang) => {
        const { spec } = checkConcept(readJson(`concepts/${e.name}/${lang}.json`))
        if (spec === undefined) throw new Error(`concepts/${e.name}/${lang}.json does not decode`)
        return spec
      }),
    )

const extraJson = {
  schema: 1,
  kind: "learn",
  lang: "en",
  title: "Widgets",
  summary: "Covers units, flow, incline and trace.",
  parts: {
    w: { label: "$mg$", role: "derived", color: "grey", meaning: "weight" },
    n: { label: "$N$", role: "derived", color: "olive", meaning: "normal force" },
    f: { label: "$f_k$", role: "derived", color: "cyan", meaning: "friction" },
    a: { label: "$a$", role: "derived", color: "green", meaning: "acceleration" },
    th: { label: "$\\theta$", role: "given", color: "orange", meaning: "angle" },
    key: { label: "key", role: "variable", color: "pink", meaning: "the key we look up" },
  },
  cards: {
    hash: { kind: "term", title: "Hash", body: "Turns a [key:key] into a number." },
  },
  sections: [
    {
      id: "plan",
      type: "units",
      title: "Study plan",
      units: [
        { id: "u1", title: "Forces", milestone: "draw a free-body diagram", lessonSlug: "forces" },
        { id: "u2", title: "Friction", milestone: "use $f_k = \\mu_k N$" },
      ],
    },
    {
      id: "pipeline",
      type: "visual",
      title: "Pipeline",
      widget: {
        kind: "flow",
        nodes: [
          { id: "k", label: "[key:key]", part: "key" },
          { id: "h", label: "{hash|hash}", card: "hash" },
          { id: "b", label: "bucket" },
        ],
        edges: [
          { from: "k", to: "h", label: "input" },
          { from: "h", to: "b", part: "key" },
        ],
      },
    },
    {
      id: "ramp",
      type: "visual",
      title: "Ramp",
      widget: {
        kind: "incline",
        params: [
          { id: "theta", label: "[th:$\\theta$]", min: 5, max: 60, step: 1, value: 30, part: "th" },
          { id: "mu", label: "$\\mu_k$", min: 0, max: 0.8, step: 0.01, value: 0.2 },
          { id: "m", label: "$m$", min: 0.5, max: 10, step: 0.5, value: 2 },
        ],
        forces: ["weight", "normal", "friction", "accel"],
        parts: { weight: "w", normal: "n", friction: "f", accel: "a" },
      },
    },
    {
      id: "trace",
      type: "visual",
      title: "Trace",
      widget: {
        kind: "trace",
        lang: "python",
        code: "def put(key, value):\n    i = hash(key) % n\n    buckets[i].append((key, value))",
        steps: [
          { line: 1, note: "call put with a [key:key]", state: { key: '"cat"' } },
          { line: 2, note: "hash it", state: { i: "0" } },
          { line: 3, note: "append", state: { "buckets[0]": '[("cat", 1)]' } },
        ],
      },
    },
  ],
}

export const loadExtra = (): LessonSpec => {
  const { spec, issues } = checkLesson(extraJson)
  if (spec === undefined || issues.length > 0) throw new Error(`extra fixture: ${JSON.stringify(issues)}`)
  return spec
}
