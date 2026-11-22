import type { Concept, ConceptHit } from "@app/api"
import { maxConceptPath } from "@app/domain"
import { type DiagramEdge, type DiagramNode, LazyDiagram } from "@app/lesson"
import { Badge, Button, cx, EmptyState, Input, type MessageKey, Spinner, useI18n } from "@app/ui"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useId, useMemo, useState } from "react"
import { conceptPathQuery, conceptSearchQuery } from "../queries.ts"

type PathSearch = { readonly to?: string | undefined }

const slugText = (value: unknown): string => (typeof value === "string" ? value.trim().slice(0, 200) : "")

export const Route = createFileRoute("/path")({
  validateSearch: (search: Record<string, unknown>): PathSearch => {
    const to = slugText(search.to)
    return to === "" ? {} : { to }
  },
  loaderDeps: (match) => match.search,
  loader: (match) => {
    if (match.deps.to !== undefined) {
      void match.context.queryClient.prefetchQuery(conceptPathQuery(match.deps.to))
    }
  },
  component: PathPage,
})

const kindMessageKey: Readonly<Record<string, MessageKey>> = {
  term: "path.kind.term",
  law: "path.kind.law",
  formula: "path.kind.formula",
  def: "path.kind.def",
  lemma: "path.kind.lemma",
  thm: "path.kind.thm",
  metric: "path.kind.metric",
  story: "path.kind.story",
  feature: "path.kind.feature",
}

const conceptTitle = (concept: Concept, locale: "en" | "th"): string => {
  const preferred = concept.langs.find((info) => info.lang === locale)
  const fallback = concept.langs[0]
  return preferred?.title ?? fallback?.title ?? concept.slug
}

const conceptKind = (concept: Concept, locale: "en" | "th"): string | undefined => {
  const preferred = concept.langs.find((info) => info.lang === locale)
  return preferred?.kind ?? concept.langs[0]?.kind
}

// Deduplicate search hits by slug, preferring the reader's current UI language.
const dedupeHits = (hits: ReadonlyArray<ConceptHit>, locale: "en" | "th"): ReadonlyArray<ConceptHit> => {
  const bySlug = new Map<string, ConceptHit>()
  for (const hit of hits) {
    const current = bySlug.get(hit.slug)
    if (current === undefined || (current.lang !== locale && hit.lang === locale)) {
      bySlug.set(hit.slug, hit)
    }
  }
  return [...bySlug.values()]
}

function PathPage() {
  const { t, locale } = useI18n()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const inputId = useId()
  const [queryText, setQueryText] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")

  useEffect(() => {
    const trimmed = queryText.trim()
    if (trimmed === "") {
      setDebouncedQuery("")
      return
    }
    const timer = window.setTimeout(() => setDebouncedQuery(trimmed), 150)
    return () => window.clearTimeout(timer)
  }, [queryText])

  const searchResult = useQuery({
    ...conceptSearchQuery(debouncedQuery),
    enabled: debouncedQuery.length > 0,
  })
  const hits = useMemo(() => dedupeHits(searchResult.data ?? [], locale), [searchResult.data, locale])

  const targetSlug = search.to
  const pathQuery = useQuery({
    ...conceptPathQuery(targetSlug ?? ""),
    enabled: targetSlug !== undefined,
  })

  const selectConcept = (slug: string) => {
    setQueryText("")
    setDebouncedQuery("")
    void navigate({ search: { to: slug } })
  }

  const ordered = pathQuery.data?.order ?? []
  const edges = pathQuery.data?.edges ?? []
  const titleBySlug = useMemo(
    () => new Map(ordered.map((concept) => [concept.slug, conceptTitle(concept, locale)])),
    [ordered, locale],
  )
  const targetConcept = ordered.find((concept) => concept.slug === targetSlug)
  const targetTitle = targetConcept === undefined ? (targetSlug ?? "") : conceptTitle(targetConcept, locale)

  // App UI uses the lavender accent only (no lesson role colors).
  const diagramNodes: ReadonlyArray<DiagramNode> = useMemo(
    () =>
      ordered.map((concept) => {
        const title = conceptTitle(concept, locale)
        const isTarget = concept.slug === targetSlug
        return {
          id: concept.slug,
          label: title,
          text: title,
          target: `concept:${concept.slug}`,
          color: isTarget ? "var(--color-accent)" : "var(--color-ink-muted)",
          variant: isTarget ? "goal" : "plain",
        }
      }),
    [ordered, locale, targetSlug],
  )
  const diagramEdges: ReadonlyArray<DiagramEdge> = useMemo(
    () =>
      edges.map((edge) => ({
        id: `path__${edge.from}__${edge.to}`,
        from: edge.from,
        to: edge.to,
        color: "var(--color-hairline-strong)",
      })),
    [edges],
  )

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t("path.title")}</h1>
        <p className="text-body-sm text-ink-subtle">{t("path.description")}</p>
      </header>

      <section aria-label={t("path.search.label")} className="flex flex-col gap-2">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            const first = hits[0]
            if (first !== undefined) {
              selectConcept(first.slug)
              return
            }
            const trimmed = queryText.trim()
            if (trimmed !== "") setDebouncedQuery(trimmed)
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            {t("path.search.label")}
          </label>
          <Input
            id={inputId}
            type="search"
            value={queryText}
            maxLength={100}
            placeholder={t("path.search.placeholder")}
            onValueChange={(value) => setQueryText(value)}
            className="flex-1"
          />
          <Button type="submit" variant="secondary">
            {t("explore.search.submit")}
          </Button>
        </form>

        {debouncedQuery === "" ? (
          <p className="text-caption text-ink-tertiary">{t("path.search.hint")}</p>
        ) : searchResult.isPending ? (
          <div className="flex items-center gap-2 py-2 text-dense text-ink-subtle">
            <Spinner size="sm" label={t("common.loading")} />
            <span>{t("common.loading")}</span>
          </div>
        ) : hits.length === 0 ? (
          <p className="text-dense text-ink-subtle">{t("path.search.empty", { query: debouncedQuery })}</p>
        ) : (
          <ul
            aria-label={t("path.search.label")}
            className="divide-y divide-hairline rounded-lg border border-hairline bg-surface-1"
          >
            {hits.map((hit) => {
              const kindKey = kindMessageKey[hit.kind]
              return (
                <li key={hit.slug}>
                  <button
                    type="button"
                    onClick={() => selectConcept(hit.slug)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-sm font-medium text-ink">{hit.title}</p>
                      <p className="truncate font-mono text-caption text-ink-tertiary">{hit.slug}</p>
                    </div>
                    {kindKey === undefined ? null : <Badge>{t(kindKey)}</Badge>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {targetSlug === undefined ? (
        <EmptyState title={t("path.empty.title")} description={t("path.empty.description")} />
      ) : pathQuery.isPending ? (
        <div className="flex items-center gap-2 py-8 text-body-sm text-ink-subtle">
          <Spinner size="sm" label={t("common.loading")} />
          <span>{t("common.loading")}</span>
        </div>
      ) : pathQuery.isError ? (
        <EmptyState
          title={t("common.error")}
          action={
            <Button size="sm" variant="secondary" onClick={() => void pathQuery.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : ordered.length === 0 ? (
        <EmptyState
          title={t("path.notFound.title")}
          description={t("path.notFound.description", { slug: targetSlug })}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {pathQuery.data?.truncated === true ? (
            <p
              role="status"
              className="rounded-lg border border-accent/40 bg-accent/10 px-3.5 py-2.5 text-dense text-ink"
            >
              {t("path.truncated", { max: maxConceptPath })}
            </p>
          ) : null}

          <section aria-labelledby="path-order-heading" className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="path-order-heading" className="text-body font-semibold text-ink">
                {t("path.order.heading")}
              </h2>
              <span className="text-caption text-ink-tertiary">
                {t("path.order.count", { count: ordered.length })}
              </span>
            </div>

            <ol className="flex flex-col gap-2">
              {ordered.map((concept, index) => {
                const title = conceptTitle(concept, locale)
                const kind = conceptKind(concept, locale)
                const kindKey = kind === undefined ? undefined : kindMessageKey[kind]
                const isTarget = concept.slug === targetSlug
                const directNeeds = concept.needs.map((need) => titleBySlug.get(need) ?? need).join(", ")

                return (
                  <li key={concept.slug} data-concept-slug={concept.slug}>
                    <button
                      type="button"
                      onClick={() => selectConcept(concept.slug)}
                      className={cx(
                        "flex w-full items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent",
                        isTarget
                          ? "border-accent bg-accent/10"
                          : "border-hairline bg-surface-1 hover:bg-surface-2",
                      )}
                    >
                      <span
                        className={cx(
                          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-caption font-medium",
                          isTarget
                            ? "bg-accent text-on-accent"
                            : "border border-hairline bg-surface-2 text-ink-muted",
                        )}
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-body-sm font-medium text-ink">{title}</span>
                          {isTarget ? <Badge tone="accent">{t("path.order.target")}</Badge> : null}
                          {kindKey === undefined ? null : <Badge>{t(kindKey)}</Badge>}
                        </div>
                        <p className="mt-0.5 font-mono text-caption text-ink-tertiary">{concept.slug}</p>
                        <p className="mt-1 text-caption text-ink-subtle">
                          {concept.needs.length === 0
                            ? t("path.order.foundation")
                            : t("path.order.needs", { list: directNeeds })}
                        </p>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ol>
          </section>

          <section aria-labelledby="path-graph-heading" className="flex flex-col gap-2">
            <h2 id="path-graph-heading" className="text-body font-semibold text-ink">
              {t("path.graph.heading")}
            </h2>
            <LazyDiagram
              nodes={diagramNodes}
              edges={diagramEdges}
              direction="BT"
              ariaLabel={t("path.graph.aria", { title: targetTitle })}
              loadingLabel={t("common.loading")}
              onSelect={selectConcept}
            />
            <p className="text-caption text-ink-tertiary">{t("path.graph.legend")}</p>
          </section>
        </div>
      )}
    </div>
  )
}
