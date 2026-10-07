import { Button, EmptyState, Input, Select, Tag, useI18n } from "@app/ui"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useId, useState } from "react"
import { categoryPath } from "../format.ts"
import { LessonList } from "../lesson-list.tsx"
import { categoriesQuery, type Feed, feedQuery } from "../queries.ts"

type ExploreSearch = { readonly category?: string | undefined; readonly tag?: string | undefined }

const categoryPattern = /^[a-z0-9-]+(\.[a-z0-9-]+){0,4}$/u

// The filter lives in the URL, so a filtered list can be shared. One filter at a time (the API
// has one feed per category and per tag): a category wins over a tag.
const feedOf = (search: ExploreSearch): Feed =>
  search.category !== undefined
    ? { kind: "category", id: search.category }
    : search.tag !== undefined
      ? { kind: "tag", slug: search.tag }
      : { kind: "new" }

export const Route = createFileRoute("/explore")({
  validateSearch: (search: Record<string, unknown>): ExploreSearch => {
    const category = typeof search.category === "string" ? search.category : ""
    const tag =
      typeof search.tag === "string" || typeof search.tag === "number" ? String(search.tag).trim() : ""
    if (categoryPattern.test(category)) return { category }
    if (tag !== "") return { tag: tag.slice(0, 40) }
    return {}
  },
  loaderDeps: (match) => ({ category: match.search.category, tag: match.search.tag }),
  loader: (match) => void match.context.queryClient.prefetchInfiniteQuery(feedQuery(feedOf(match.deps))),
  component: ExplorePage,
})

const allCategories = "__all__"

function ExplorePage() {
  const { t, locale } = useI18n()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const categories = useQuery(categoriesQuery)
  const feed = useInfiniteQuery(feedQuery(feedOf(search)))
  const [tagDraft, setTagDraft] = useState(search.tag ?? "")
  const tagId = useId()
  useEffect(() => setTagDraft(search.tag ?? ""), [search.tag])

  const filtered = search.category !== undefined || search.tag !== undefined
  const categoryOptions = [
    { value: allCategories, label: t("explore.allCategories") },
    ...(categories.data ?? [])
      .map((category) => ({
        value: category.id,
        label: categoryPath(categories.data ?? [], category.id, locale),
      }))
      .toSorted((a, b) => a.label.localeCompare(b.label, locale)),
  ]

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t("explore.title")}</h1>
        <p className="text-body-sm text-ink-subtle">{t("explore.description")}</p>
      </header>

      <section aria-label={t("explore.filters")} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Select
          label={t("explore.category")}
          className="sm:w-64"
          options={categoryOptions}
          value={search.category ?? allCategories}
          onValueChange={(value) =>
            void navigate({ search: value === allCategories ? {} : { category: value } })
          }
        />
        <form
          className="flex min-w-0 flex-1 flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            const tag = tagDraft.trim()
            void navigate({ search: tag === "" ? {} : { tag } })
          }}
        >
          <label htmlFor={tagId} className="text-dense font-medium text-ink-muted">
            {t("explore.tag")}
          </label>
          <div className="flex gap-2">
            <Input
              id={tagId}
              type="search"
              value={tagDraft}
              maxLength={40}
              placeholder={t("explore.tagPlaceholder")}
              onValueChange={(value) => setTagDraft(value)}
            />
            <Button type="submit">{t("explore.apply")}</Button>
          </div>
        </form>
      </section>

      {filtered ? (
        <div className="flex flex-wrap items-center gap-2">
          {search.tag === undefined ? null : <Tag>{search.tag}</Tag>}
          <Button variant="ghost" size="sm" onClick={() => void navigate({ search: {} })}>
            {t("explore.clear")}
          </Button>
        </div>
      ) : null}

      <LessonList
        query={feed}
        label={t("feed.label")}
        errorMessage={(tag) => (tag === "CategoryNotFound" ? t("explore.unknownFilter") : undefined)}
        empty={
          filtered ? (
            <EmptyState
              title={t("explore.noMatch.title")}
              description={t("explore.noMatch.description")}
              action={
                <Button size="sm" onClick={() => void navigate({ search: {} })}>
                  {t("explore.clear")}
                </Button>
              }
            />
          ) : (
            <EmptyState title={t("empty.explore.title")} description={t("empty.explore.description")} />
          )
        }
      />
    </div>
  )
}
