import type { Category } from "@app/api"
import type { LessonKind } from "@app/domain"
import type { Locale, MessageKey } from "@app/ui"

export const kindKey: Record<LessonKind, MessageKey> = {
  solve: "lesson.kind.solve",
  learn: "lesson.kind.learn",
  situation: "lesson.kind.situation",
  code: "lesson.kind.code",
  proof: "lesson.kind.proof",
  guide: "lesson.kind.guide",
}

export const visibilityKey = {
  private: "visibility.private",
  unlisted: "visibility.unlisted",
  public: "visibility.public",
} as const satisfies Record<string, MessageKey>

export const categoryName = (category: Category, locale: Locale) =>
  locale === "th" ? category.name_th : category.name_en

export function formatDate(millis: number, locale: Locale) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(millis))
}

export type CategoryNode = { readonly category: Category; readonly children: ReadonlyArray<CategoryNode> }

// The curated tree from the flat list (parent_id), each level in `sort` order.
export function categoryTree(categories: ReadonlyArray<Category>): ReadonlyArray<CategoryNode> {
  const byParent = new Map<string | null, Array<Category>>()
  for (const category of categories) {
    const siblings = byParent.get(category.parent_id) ?? []
    siblings.push(category)
    byParent.set(category.parent_id, siblings)
  }
  const build = (parent: string | null): ReadonlyArray<CategoryNode> =>
    (byParent.get(parent) ?? [])
      .toSorted((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
      .map((category) => ({ category, children: build(category.id) }))
  return build(null)
}

// "physics.mechanics" -> "Physics / Mechanics" for a select option.
export function categoryPath(categories: ReadonlyArray<Category>, id: string, locale: Locale) {
  const byId = new Map(categories.map((category) => [category.id, category]))
  const names: Array<string> = []
  let current = byId.get(id)
  while (current !== undefined) {
    names.unshift(categoryName(current, locale))
    current = current.parent_id === null ? undefined : byId.get(current.parent_id)
  }
  return names.join(" / ")
}
