import type { LessonLang } from "@app/domain"

// Search params arrive as unknown JSON-ish values; these keep only what the routes understand.
export const langParam = (value: unknown): LessonLang | undefined =>
  value === "en" || value === "th" ? value : undefined

export const stringParam = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined

export const oneOf =
  <T extends string>(values: ReadonlyArray<T>) =>
  (value: unknown): T | undefined =>
    values.find((v) => v === value)

export interface ReaderSearch {
  readonly lang?: LessonLang | undefined
}

export const validateReaderSearch = (search: Record<string, unknown>): ReaderSearch => ({
  lang: langParam(search.lang),
})
