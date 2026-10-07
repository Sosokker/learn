import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { ConceptSpec, LessonSpec, type PinnedConcept } from "@app/domain"
import { Schema } from "effect"

const root = join(import.meta.dirname, "../../../content")
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"))

export const guide = (lang: "en" | "th"): LessonSpec =>
  Schema.decodeUnknownSync(LessonSpec)(readJson(join(root, "guide", `${lang}.json`)))

export const concepts: ReadonlyArray<PinnedConcept> = readdirSync(join(root, "concepts")).flatMap((slug) =>
  readdirSync(join(root, "concepts", slug)).map((f) => {
    const spec = Schema.decodeUnknownSync(ConceptSpec)(readJson(join(root, "concepts", slug, f)))
    return { slug: spec.slug, version: 1, useCount: 3, spec }
  }),
)
