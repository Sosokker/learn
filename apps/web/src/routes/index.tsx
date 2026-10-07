import { buttonClass, Card, EmptyState, useI18n } from "@app/ui"
import { useInfiniteQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { FlagIcon } from "../icons.tsx"
import { LessonList } from "../lesson-list.tsx"
import { feedQuery } from "../queries.ts"

const homeFeed = feedQuery({ kind: "new" }, 10)

export const Route = createFileRoute("/")({
  loader: (match) => void match.context.queryClient.prefetchInfiniteQuery(homeFeed),
  component: HomePage,
})

function HomePage() {
  const { t } = useI18n()
  const feed = useInfiniteQuery(homeFeed)
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t("home.title")}</h1>
        <p className="text-body-sm text-ink-subtle">{t("home.subtitle")}</p>
      </header>

      <section aria-labelledby="home-pinned">
        <h2 id="home-pinned" className="sr-only">
          {t("home.pinned")}
        </h2>
        <Card interactive>
          <div className="flex items-center gap-2 text-caption font-medium text-ink-subtle">
            <span className="text-accent">
              <FlagIcon />
            </span>
            {t("home.pinned")}
          </div>
          <h3 className="text-body font-semibold text-ink">
            <Link to="/guide" className="no-underline after:absolute after:inset-0 after:rounded-lg">
              {t("home.guide.title")}
            </Link>
          </h3>
          <p className="text-body-sm text-ink-subtle">{t("home.guide.description")}</p>
          <span aria-hidden className={`${buttonClass("primary", "sm")} self-start`}>
            {t("home.guide.open")}
          </span>
        </Card>
      </section>

      <section aria-labelledby="home-new" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="home-new" className="text-body font-semibold text-ink">
            {t("home.new")}
          </h2>
          <Link to="/explore" className="text-dense text-accent-hover hover:underline">
            {t("home.seeAll")}
          </Link>
        </div>
        <LessonList
          query={feed}
          label={t("home.new")}
          empty={<EmptyState title={t("empty.explore.title")} description={t("empty.explore.description")} />}
        />
      </section>
    </div>
  )
}
