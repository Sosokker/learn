import { BookIcon, ChevronRightIcon, GuideIcon, useI18n } from "@app/ui"
import { useInfiniteQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { LessonRow } from "../components/LessonRow.tsx"
import { TopBar } from "../components/Shell.tsx"
import { EmptyState, ErrorState, RowSkeletons } from "../components/states.tsx"
import { feedQuery } from "../lib/queries.ts"

export const Route = createFileRoute("/")({ component: HomePage })

function HomePage() {
  const { t } = useI18n()
  const feed = useInfiniteQuery(feedQuery({ sort: "new" }))
  const lessons = feed.data?.pages[0]?.items ?? []

  return (
    <>
      <TopBar title={t("home.title")} />
      <div className="px-6 pt-6 pb-2 max-md:px-4 max-md:pt-4">
        <Link
          to="/guide"
          className="group flex items-start gap-4 rounded-lg border border-hairline bg-surface-1 p-5 transition-colors duration-100 hover:border-hairline-strong hover:bg-surface-2 max-md:p-4"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-hairline-strong bg-surface-3 text-primary-hover">
            <GuideIcon className="size-4.5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-caption font-medium tracking-[0.4px] text-ink-subtle">
              {t("home.pinnedEyebrow")}
            </span>
            <span className="text-subhead font-semibold tracking-[-0.2px] text-ink max-md:text-body">
              {t("home.pinnedTitle")}
            </span>
            <span className="max-w-2xl text-dense text-ink-subtle">{t("home.pinnedBody")}</span>
            <span className="mt-2 inline-flex items-center gap-1 text-dense font-medium text-primary-hover">
              {t("home.pinnedCta")}
              <ChevronRightIcon className="size-3.5 transition-transform duration-100 group-hover:translate-x-0.5" />
            </span>
          </span>
        </Link>
      </div>

      <section aria-labelledby="newest" className="flex flex-col">
        <div className="flex h-11 items-center justify-between gap-2 border-b border-hairline px-6 max-md:px-4">
          <h2 id="newest" className="text-dense font-medium text-ink-muted">
            {t("home.newest")}
          </h2>
          <Link to="/explore" className="rounded-sm text-dense text-ink-subtle hover:text-ink">
            {t("home.seeAll")}
          </Link>
        </div>
        {feed.isPending ? (
          <RowSkeletons count={8} />
        ) : feed.isError ? (
          <ErrorState error={feed.error} onRetry={() => feed.refetch()} />
        ) : lessons.length === 0 ? (
          <EmptyState icon={<BookIcon />} title={t("home.empty")} body={t("home.emptyBody")} />
        ) : (
          <div>
            {lessons.map((lesson) => (
              <LessonRow key={lesson.id} lesson={lesson} />
            ))}
          </div>
        )}
      </section>
    </>
  )
}
