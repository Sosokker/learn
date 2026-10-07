import { type FeedSort, LessonKind, LessonLang, TagSlug } from "@app/domain"
import {
  Button,
  CompassIcon,
  Input,
  SearchIcon,
  SegmentedControl,
  Select,
  type SelectOption,
  useI18n,
} from "@app/ui"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { useEffect, useId, useMemo, useState } from "react"
import { LessonRow } from "../components/LessonRow.tsx"
import { TopBar } from "../components/Shell.tsx"
import { EmptyState, ErrorState, RowSkeletons } from "../components/states.tsx"
import { buildTree, categoryOptions, withDescendants } from "../lib/categories.ts"
import { categoriesQuery, feedQuery, tagsQuery } from "../lib/queries.ts"
import { langParam, oneOf, stringParam } from "../lib/search.ts"

interface ExploreSearch {
  readonly q?: string | undefined
  readonly sort?: FeedSort | undefined
  readonly category?: string | undefined
  readonly kind?: LessonKind | undefined
  readonly lang?: LessonLang | undefined
  readonly tag?: string | undefined
}

const kinds = LessonKind.literals
const isTag = Schema.is(TagSlug)

export const Route = createFileRoute("/explore")({
  validateSearch: (search: Record<string, unknown>): ExploreSearch => ({
    q: stringParam(search.q),
    sort: oneOf<FeedSort>(["new", "hot"])(search.sort),
    category: stringParam(search.category),
    kind: oneOf(kinds)(search.kind),
    lang: langParam(search.lang),
    tag: stringParam(search.tag),
  }),
  component: ExplorePage,
})

// Typing updates the URL after a pause, so the feed isn't fetched per keystroke.
function useDebounced(value: string, ms: number, onSettle: (value: string) => void) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: onSettle changes every render
  useEffect(() => {
    const id = setTimeout(() => onSettle(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
}

function ExplorePage() {
  const { t, lang: uiLang } = useI18n()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const sort = search.sort ?? "new"

  const update = (patch: Partial<ExploreSearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })

  const [q, setQ] = useState(search.q ?? "")
  const [tag, setTag] = useState(search.tag ?? "")
  useEffect(() => setQ(search.q ?? ""), [search.q])
  useEffect(() => setTag(search.tag ?? ""), [search.tag])
  useDebounced(q, 300, (v) => {
    const next = v.trim() || undefined
    if (next !== search.q) void update({ q: next })
  })
  useDebounced(tag, 300, (v) => {
    const next = v.trim().toLowerCase() || undefined
    if (next !== search.tag && (next === undefined || isTag(next))) void update({ tag: next })
  })

  const categories = useQuery(categoriesQuery)
  const tree = useMemo(() => (categories.data ? buildTree(categories.data) : []), [categories.data])

  // The feed takes a category with all its descendants. Wait for the tree before asking, unless
  // it failed to load: then the single id is better than nothing.
  const categoryParam = !search.category
    ? undefined
    : categories.data
      ? withDescendants(categories.data, search.category).join(",")
      : categories.isError
        ? search.category
        : null

  const feed = useInfiniteQuery({
    ...feedQuery({
      sort,
      kind: search.kind,
      lang: search.lang,
      categories: categoryParam ?? undefined,
      tag: search.tag && isTag(search.tag) ? search.tag : undefined,
      q: search.q,
    }),
    enabled: categoryParam !== null,
  })

  const tags = useQuery(tagsQuery(tag.trim().toLowerCase()))
  const tagListId = useId()

  const lessons = feed.data?.pages.flatMap((p) => p.items) ?? []
  const filtered = Boolean(search.q || search.category || search.kind || search.lang || search.tag)

  const kindOptions: ReadonlyArray<SelectOption> = [
    { value: "", label: t("explore.anyKind") },
    ...kinds.map((k) => ({ value: k, label: t(`kind.${k}`) })),
  ]
  const langOptions: ReadonlyArray<SelectOption> = [
    { value: "", label: t("explore.anyLang") },
    ...LessonLang.literals.map((l) => ({ value: l, label: t(`lessonLang.${l}`) })),
  ]

  return (
    <>
      <TopBar title={t("explore.title")} />
      <div className="flex flex-col gap-3 border-b border-hairline px-6 py-4 max-md:px-4">
        <div className="flex items-center gap-2 max-sm:flex-col max-sm:items-stretch">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-tertiary" />
            <Input
              type="search"
              aria-label={t("explore.search")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("explore.searchPlaceholder")}
              className="pl-8"
            />
          </div>
          <SegmentedControl<FeedSort>
            className="max-sm:self-start"
            label={t("explore.sort")}
            value={sort}
            onChange={(v) => update({ sort: v === "new" ? undefined : v })}
            options={[
              { value: "new", label: t("explore.sortNew") },
              { value: "hot", label: t("explore.sortHot") },
            ]}
          />
        </div>
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">{t("explore.filters")}</legend>
          <Select
            aria-label={t("explore.category")}
            value={search.category ?? ""}
            onChange={(e) => update({ category: e.target.value || undefined })}
            options={[{ value: "", label: t("explore.anyCategory") }, ...categoryOptions(tree, uiLang)]}
            className="w-48 max-sm:w-full"
          />
          <Select
            aria-label={t("explore.kind")}
            value={search.kind ?? ""}
            onChange={(e) => update({ kind: oneOf(kinds)(e.target.value) })}
            options={kindOptions}
            className="w-36 max-sm:w-[calc(50%-4px)]"
          />
          <Select
            aria-label={t("explore.lang")}
            value={search.lang ?? ""}
            onChange={(e) => update({ lang: langParam(e.target.value) })}
            options={langOptions}
            className="w-36 max-sm:w-[calc(50%-4px)]"
          />
          <div className="w-40 max-sm:w-full">
            <Input
              aria-label={t("explore.tag")}
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder={`# ${t("explore.tagPlaceholder")}`}
              list={tagListId}
              autoCapitalize="none"
              spellCheck={false}
            />
            <datalist id={tagListId}>
              {(tags.data ?? []).map((s) => (
                <option key={s.slug} value={s.slug} />
              ))}
            </datalist>
          </div>
          {filtered ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate({ search: { sort: search.sort }, replace: true })}
            >
              {t("explore.clear")}
            </Button>
          ) : null}
        </fieldset>
      </div>

      {feed.isPending ? (
        <RowSkeletons count={10} />
      ) : feed.isError && lessons.length === 0 ? (
        <ErrorState error={feed.error} onRetry={() => feed.refetch()} />
      ) : lessons.length === 0 ? (
        <EmptyState
          icon={<CompassIcon />}
          title={filtered ? t("explore.empty") : t("home.empty")}
          body={filtered ? t("explore.emptyBody") : t("home.emptyBody")}
        />
      ) : (
        <div>
          {lessons.map((lesson) => (
            <LessonRow key={lesson.id} lesson={lesson} />
          ))}
          {feed.hasNextPage || feed.isFetchNextPageError ? (
            <div className="flex flex-col items-center gap-2 px-6 py-6">
              {feed.isFetchNextPageError ? (
                <p role="alert" className="text-dense text-danger">
                  {t("error.title")}
                </p>
              ) : null}
              <Button onClick={() => feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
                {feed.isFetchingNextPage ? t("common.loading") : t("common.loadMore")}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </>
  )
}
