import type { FeedSort } from "@app/api"
import { LessonKind, LessonLang } from "@app/domain"
import { Button, cx, EmptyState, Input, Select, useI18n } from "@app/ui"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { useEffect, useId, useState } from "react"
import { categoryPath, kindKey } from "../format.ts"
import { LessonList } from "../lesson-list.tsx"
import { categoriesQuery, type Feed, feedQuery, lessonSearchQuery } from "../queries.ts"

type ExploreSearch = {
  readonly q?: string | undefined
  readonly category?: string | undefined
  readonly tag?: string | undefined
  readonly kind?: LessonKind | undefined
  readonly lang?: LessonLang | undefined
  readonly sort?: FeedSort | undefined
}

const categoryPattern = /^[a-z0-9-]+(\.[a-z0-9-]+){0,4}$/u
const isKind = Schema.is(LessonKind)
const isLang = Schema.is(LessonLang)
const kinds = LessonKind.literals

const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value).trim() : ""

// The filter lives in the URL, so a filtered list can be shared. The API has one index per feed,
// so one filter at a time (category, then tag, kind, language), and Hot only where an index
// covers it (not with a category or a language). A search (`q`) uses the language only.
const feedOf = (search: ExploreSearch): Feed => {
  const sort = search.sort ?? "new"
  if (search.category !== undefined) return { kind: "category", id: search.category }
  if (search.tag !== undefined) return { kind: "tag", slug: search.tag, sort }
  if (search.lang !== undefined) return { kind: "new", lang: search.lang }
  return sort === "hot" ? { kind: "hot", lessonKind: search.kind } : { kind: "new", lessonKind: search.kind }
}

export const Route = createFileRoute("/explore")({
  validateSearch: (search: Record<string, unknown>): ExploreSearch => {
    const q = text(search.q).slice(0, 100)
    const sort = search.sort === "hot" ? ({ sort: "hot" } as const) : {}
    const lang = isLang(search.lang) ? { lang: search.lang } : {}
    const filter = (() => {
      const category = text(search.category)
      if (categoryPattern.test(category)) return { category }
      const tag = text(search.tag)
      if (tag !== "") return { tag: tag.slice(0, 40) }
      if (isKind(search.kind)) return { kind: search.kind }
      return lang
    })()
    return q === "" ? { ...filter, ...sort } : { q, ...lang }
  },
  loaderDeps: (match) => match.search,
  loader: (match) =>
    void (match.deps.q === undefined
      ? match.context.queryClient.prefetchInfiniteQuery(feedQuery(feedOf(match.deps)))
      : match.context.queryClient.prefetchInfiniteQuery(lessonSearchQuery(match.deps.q, match.deps.lang))),
  component: ExplorePage,
})

const allCategories = "__all__"
const allKinds = "__all__"
const allLangs = "__all__"

function ExplorePage() {
  const { t, locale } = useI18n()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const categories = useQuery(categoriesQuery)
  const searching = search.q !== undefined
  const feed = useInfiniteQuery({ ...feedQuery(feedOf(search)), enabled: !searching })
  const results = useInfiniteQuery({
    ...lessonSearchQuery(search.q ?? "", search.lang),
    enabled: searching,
  })
  const [tagDraft, setTagDraft] = useState(search.tag ?? "")
  const [queryDraft, setQueryDraft] = useState(search.q ?? "")
  const tagId = useId()
  const queryId = useId()
  const hotHintId = useId()
  useEffect(() => setTagDraft(search.tag ?? ""), [search.tag])
  useEffect(() => setQueryDraft(search.q ?? ""), [search.q])

  // Keeps the sort (and the search) and replaces the one filter.
  const setFilter = (filter: Partial<Pick<ExploreSearch, "category" | "tag" | "kind" | "lang">>) =>
    void navigate({
      search: {
        ...(search.q === undefined ? {} : { q: search.q }),
        ...(search.sort === undefined ? {} : { sort: search.sort }),
        ...filter,
      },
    })
  const hotAvailable = search.category === undefined && search.lang === undefined
  const sort = hotAvailable ? (search.sort ?? "new") : "new"
  const filtered =
    search.category !== undefined ||
    search.tag !== undefined ||
    search.kind !== undefined ||
    search.lang !== undefined

  const categoryOptions = [
    { value: allCategories, label: t("explore.allCategories") },
    ...(categories.data ?? [])
      .map((category) => ({
        value: category.id,
        label: categoryPath(categories.data ?? [], category.id, locale),
      }))
      .toSorted((a, b) => a.label.localeCompare(b.label, locale)),
  ]
  const kindOptions = [
    { value: allKinds, label: t("explore.allKinds") },
    ...kinds.map((kind) => ({ value: kind, label: t(kindKey[kind]) })),
  ]
  const langOptions = [
    { value: allLangs, label: t("explore.allLangs") },
    { value: "en", label: t("lang.en") },
    { value: "th", label: t("lang.th") },
  ]
  const langSelect = (
    <Select
      label={t("lang.label")}
      options={langOptions}
      value={search.lang ?? allLangs}
      onValueChange={(value) => setFilter(isLang(value) ? { lang: value } : {})}
      hideLabel
      className="w-36"
    />
  )

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t("explore.title")}</h1>
        <p className="text-body-sm text-ink-subtle">{t("explore.description")}</p>
      </header>

      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="flex grow basis-56 gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              const q = queryDraft.trim()
              void navigate({
                search: q === "" ? {} : { q, ...(search.lang === undefined ? {} : { lang: search.lang }) },
              })
            }}
          >
            <label htmlFor={queryId} className="sr-only">
              {t("explore.search.label")}
            </label>
            <Input
              id={queryId}
              type="search"
              value={queryDraft}
              maxLength={100}
              placeholder={t("explore.search.placeholder")}
              onValueChange={(value) => setQueryDraft(value)}
              className="flex-1"
            />
            <Button type="submit">{t("explore.search.submit")}</Button>
          </form>
          {searching ? null : (
            <fieldset className="m-0 inline-flex h-8 shrink-0 items-center rounded-md border border-hairline p-0.5">
              <legend className="sr-only">{t("explore.sort")}</legend>
              {(["new", "hot"] as const).map((value) => {
                const unavailable = value === "hot" && !hotAvailable
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={sort === value}
                    aria-describedby={unavailable ? hotHintId : undefined}
                    disabled={unavailable}
                    onClick={() =>
                      void navigate({ search: { ...search, sort: value === "hot" ? "hot" : undefined } })
                    }
                    className={cx(
                      "h-full rounded px-2.5 text-dense font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50",
                      sort === value ? "bg-surface-4 text-ink" : "text-ink-subtle hover:text-ink",
                    )}
                  >
                    {t(value === "hot" ? "explore.sort.hot" : "explore.sort.new")}
                  </button>
                )
              })}
            </fieldset>
          )}
        </div>

        {searching ? (
          <div className="flex flex-wrap items-center gap-2">
            {langSelect}
            <p className="text-body-sm text-ink-muted">
              {t("explore.search.results", { query: search.q ?? "" })}
            </p>
            <Button variant="ghost" size="sm" onClick={() => void navigate({ search: {} })}>
              {t("explore.search.clear")}
            </Button>
          </div>
        ) : (
          <section aria-label={t("explore.filters")} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                label={t("explore.category")}
                options={categoryOptions}
                value={search.category ?? allCategories}
                onValueChange={(value) => setFilter(value === allCategories ? {} : { category: value })}
                hideLabel
                className="w-52"
              />
              <Select
                label={t("explore.kind")}
                options={kindOptions}
                value={search.kind ?? allKinds}
                onValueChange={(value) => setFilter(isKind(value) ? { kind: value } : {})}
                hideLabel
                className="w-32"
              />
              {langSelect}
              <form
                className="flex min-w-56 grow gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  const tag = tagDraft.trim()
                  setFilter(tag === "" ? {} : { tag })
                }}
              >
                <label htmlFor={tagId} className="sr-only">
                  {t("explore.tag")}
                </label>
                <Input
                  id={tagId}
                  type="search"
                  value={tagDraft}
                  maxLength={40}
                  placeholder={t("explore.tagPlaceholder")}
                  onValueChange={(value) => setTagDraft(value)}
                  className="min-w-28 flex-1"
                />
                <Button type="submit" variant="secondary">
                  {t("explore.apply")}
                </Button>
              </form>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="text-caption text-ink-tertiary">{t("explore.oneFilter")}</p>
              {hotAvailable ? null : (
                <p id={hotHintId} className="text-caption text-ink-tertiary">
                  {t("explore.sort.hotUnavailable")}
                </p>
              )}
              {filtered ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void navigate({ search: search.sort === undefined ? {} : { sort: search.sort } })
                  }
                >
                  {t("explore.clear")}
                </Button>
              ) : null}
            </div>
          </section>
        )}
      </div>

      {searching ? (
        <LessonList
          query={results}
          label={t("explore.search.list")}
          empty={
            <EmptyState
              title={t("search.noResults", { query: search.q ?? "" })}
              description={t("search.noResultsHint")}
            />
          }
        />
      ) : (
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
      )}
    </div>
  )
}
