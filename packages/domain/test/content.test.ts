// Every file in content/guide and content/concepts must decode, validate, and match its translation.

import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  type ConceptSpec,
  checkConcept,
  checkLesson,
  compareConceptTranslations,
  compareTranslations,
  type LessonSpec,
  maxLessonBytes,
  validateConceptGraph,
} from "../src/index.ts"

const content = fileURLToPath(new URL("../../../content/", import.meta.url))
const langs = ["en", "th"] as const
const readJson = (path: string): unknown => JSON.parse(readFileSync(`${content}${path}`, "utf8"))

const conceptSlugs = readdirSync(`${content}concepts`, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()

const concepts = new Map<string, ConceptSpec>()
for (const slug of conceptSlugs) {
  for (const lang of langs) {
    const { spec } = checkConcept(readJson(`concepts/${slug}/${lang}.json`))
    if (spec !== undefined) concepts.set(`${slug}/${lang}`, spec)
  }
}

describe("content/concepts", () => {
  it("has concepts", () => {
    expect(conceptSlugs.length).toBeGreaterThan(0)
  })

  for (const slug of conceptSlugs) {
    describe(slug, () => {
      for (const lang of langs) {
        it(`${lang}.json decodes and validates`, () => {
          const { spec, issues } = checkConcept(readJson(`concepts/${slug}/${lang}.json`))
          expect(issues).toEqual([])
          expect(spec?.slug).toBe(slug)
          expect(spec?.lang).toBe(lang)
        })
      }

      it("en and th match", () => {
        const en = concepts.get(`${slug}/en`)
        const th = concepts.get(`${slug}/th`)
        expect(en && th && compareConceptTranslations(en, th)).toEqual([])
      })
    })
  }

  for (const lang of langs) {
    it(`${lang} concept graph resolves and has no cycles`, () => {
      const set = conceptSlugs.flatMap((slug) => concepts.get(`${slug}/${lang}`) ?? [])
      expect(set).toHaveLength(conceptSlugs.length)
      expect(validateConceptGraph(set)).toEqual([])
    })
  }
})

describe("content/guide", () => {
  // A lesson may only point at concepts that exist in content/concepts, in its own language.
  const resolver = (lang: string) => (slug: string, version: number | undefined) =>
    version === undefined && concepts.has(`${slug}/${lang}`)

  const lessons = new Map<string, LessonSpec>()
  for (const lang of langs) {
    const { spec } = checkLesson(readJson(`guide/${lang}.json`), { resolveConcept: resolver(lang) })
    if (spec !== undefined) lessons.set(lang, spec)
  }

  for (const lang of langs) {
    it(`${lang}.json decodes and validates`, () => {
      const raw = readFileSync(`${content}guide/${lang}.json`)
      expect(raw.byteLength).toBeLessThanOrEqual(maxLessonBytes)
      const { spec, issues } = checkLesson(JSON.parse(raw.toString("utf8")), {
        resolveConcept: resolver(lang),
      })
      expect(issues).toEqual([])
      expect(spec?.lang).toBe(lang)
      expect(spec?.kind).toBe("guide")
    })
  }

  it("en and th match", () => {
    const en = lessons.get("en")
    const th = lessons.get("th")
    expect(en && th && compareTranslations(en, th)).toEqual([])
  })
})
