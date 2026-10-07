import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
  type ConceptSpec,
  ConceptSpec as ConceptSpecSchema,
  conceptSetIssues,
  isConceptRef,
  type LessonSpec,
  LessonSpec as LessonSpecSchema,
  parseConceptRef,
  translationIssues,
  validateLesson,
} from "../src/index.ts"

// Every file under content/ must decode, and every reference in it must resolve.
const root = join(import.meta.dirname, "../../../content")
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"))

const conceptDirs = readdirSync(join(root, "concepts"))
const concepts: Array<ConceptSpec> = conceptDirs.flatMap((slug) =>
  readdirSync(join(root, "concepts", slug)).map((f) => {
    const c = Schema.decodeUnknownSync(ConceptSpecSchema)(readJson(join(root, "concepts", slug, f)))
    expect(c.slug, `${slug}/${f}`).toBe(slug)
    expect(`${c.lang}.json`, `${slug}/${f}`).toBe(f)
    return c
  }),
)
const conceptSlugs = new Set(concepts.map((c) => c.slug))

const lessonDirs = ["guide"]

describe("content", () => {
  it("concepts are valid, translated, and acyclic", () => {
    expect(conceptSetIssues(concepts)).toEqual([])
    for (const slug of conceptDirs) {
      const langs = concepts.filter((c) => c.slug === slug).map((c) => c.lang)
      expect(langs.sort(), slug).toEqual(["en", "th"])
    }
  })

  for (const dir of lessonDirs) {
    describe(dir, () => {
      const specs: Record<string, LessonSpec> = {}
      for (const f of readdirSync(join(root, dir))) {
        const spec = Schema.decodeUnknownSync(LessonSpecSchema)(readJson(join(root, dir, f)))
        specs[spec.lang] = spec
        it(`${f} decodes, matches its file name, and every reference resolves`, () => {
          expect(`${spec.lang}.json`).toBe(f)
          expect(validateLesson(spec, { concepts: conceptSlugs })).toEqual([])
        })
      }

      it("en and th share every id", () => {
        const { en, th } = specs
        expect(en && th).toBeTruthy()
        if (en && th) expect(translationIssues(en, th)).toEqual([])
      })

      it("shared concepts exist in the lesson's language", () => {
        for (const spec of Object.values(specs)) {
          for (const c of Object.values(spec.cards)) {
            if (!isConceptRef(c)) continue
            const { slug } = parseConceptRef(c.concept)
            expect(
              concepts.some((k) => k.slug === slug && k.lang === spec.lang),
              `${slug} (${spec.lang})`,
            ).toBe(true)
          }
        }
      })
    })
  }
})
