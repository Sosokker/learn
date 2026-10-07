import type { Category, CategoryId } from "@app/domain"
import type { SelectOption, UiLang } from "@app/ui"

export interface CategoryNode {
  readonly category: Category
  readonly children: ReadonlyArray<CategoryNode>
  readonly depth: number
}

export const categoryName = (c: Category, lang: UiLang): string => (lang === "th" ? c.nameTh : c.nameEn)

const bySort = (a: Category, b: Category) => a.sort - b.sort

export function buildTree(categories: ReadonlyArray<Category>): ReadonlyArray<CategoryNode> {
  const children = new Map<CategoryId | null, Array<Category>>()
  for (const c of categories) {
    const list = children.get(c.parentId) ?? []
    list.push(c)
    children.set(c.parentId, list)
  }
  const build = (parent: CategoryId | null, depth: number): ReadonlyArray<CategoryNode> =>
    (children.get(parent) ?? [])
      .sort(bySort)
      .map((category) => ({ category, depth, children: build(category.id, depth + 1) }))
  return build(null, 0)
}

// A category and everything under it: the feed filter sends them all, comma-separated.
export function withDescendants(categories: ReadonlyArray<Category>, id: string): ReadonlyArray<string> {
  const out = [id]
  for (let i = 0; i < out.length; i++) {
    for (const c of categories) if (c.parentId === out[i]) out.push(c.id)
  }
  return out
}

// Ids of the ancestors of `id`, so the sidebar can open the branch that holds the current filter.
export function ancestors(categories: ReadonlyArray<Category>, id: string): ReadonlyArray<string> {
  const byId = new Map(categories.map((c) => [c.id as string, c]))
  const out: Array<string> = []
  let current = byId.get(id)?.parentId ?? null
  while (current !== null && !out.includes(current)) {
    out.push(current)
    current = byId.get(current)?.parentId ?? null
  }
  return out
}

// Options for a native <select>, indented by depth (a <select> can't nest groups deeper than one).
export function categoryOptions(
  tree: ReadonlyArray<CategoryNode>,
  lang: UiLang,
): ReadonlyArray<SelectOption> {
  const out: Array<SelectOption> = []
  const walk = (nodes: ReadonlyArray<CategoryNode>) => {
    for (const n of nodes) {
      out.push({ value: n.category.id, label: `${"   ".repeat(n.depth)}${categoryName(n.category, lang)}` })
      walk(n.children)
    }
  }
  walk(tree)
  return out
}
