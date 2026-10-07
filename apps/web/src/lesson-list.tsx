import type { LessonPage, LessonSummary } from "@app/api"
import { Badge, Button, EmptyState, Spinner, Tag, useI18n } from "@app/ui"
import type { InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { errorTag } from "./api.ts"
import { kindKey, visibilityKey } from "./format.ts"
import { HeartIcon } from "./icons.tsx"

// One lesson row, Linear issue style: kind · title (link) · summary · tags · author · likes.
// `actions` (library) sits at the end of the row.
export function LessonRow(props: {
  readonly lesson: LessonSummary
  readonly showVisibility?: boolean
  readonly actions?: ReactNode
}) {
  const { t } = useI18n()
  const lesson = props.lesson
  return (
    <li className="flex flex-col gap-1.5 border-b border-hairline px-3 py-3 last:border-b-0 sm:px-4">
      <div className="flex min-w-0 items-start gap-2">
        <Badge className="mt-0.5">{t(kindKey[lesson.kind])}</Badge>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Link
            to="/@{$handle}/$slug"
            params={{ handle: lesson.owner_handle, slug: lesson.slug }}
            className="min-w-0 text-body-sm font-medium break-words text-ink no-underline hover:text-accent-hover"
          >
            {lesson.title}
          </Link>
          {lesson.summary === "" ? null : (
            <p className="line-clamp-2 text-dense text-ink-subtle">{lesson.summary}</p>
          )}
        </div>
        {props.actions === undefined ? null : <div className="flex shrink-0 gap-1">{props.actions}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-0 text-caption text-ink-tertiary sm:pl-[3.25rem]">
        {props.showVisibility === true ? (
          <Badge tone={lesson.visibility === "public" ? "accent" : "neutral"}>
            {t(visibilityKey[lesson.visibility])}
          </Badge>
        ) : null}
        <span>{t("lesson.by", { author: `@${lesson.owner_handle}` })}</span>
        <span className="uppercase">{lesson.langs.join(" · ")}</span>
        <span
          className="inline-flex items-center gap-1"
          title={t("lesson.likes", { count: lesson.like_count })}
        >
          <HeartIcon />
          <span aria-hidden>{lesson.like_count}</span>
          <span className="sr-only">{t("lesson.likes", { count: lesson.like_count })}</span>
        </span>
        {lesson.tags.length === 0 ? null : (
          <ul className="flex flex-wrap gap-1.5" aria-label={t("explore.tag")}>
            {lesson.tags.map((tag) => (
              <li key={tag}>
                <Link to="/explore" search={{ tag }} className="no-underline hover:[&>span]:text-ink">
                  <Tag>{tag}</Tag>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  )
}

// A keyset-paged list: rows, a "load more" button, and the loading / empty / error states.
export function LessonList(props: {
  readonly query: UseInfiniteQueryResult<InfiniteData<LessonPage>>
  readonly label: string
  readonly empty: ReactNode
  readonly showVisibility?: boolean
  readonly actions?: (lesson: LessonSummary) => ReactNode
  readonly errorMessage?: (tag: string) => string | undefined
}) {
  const { t } = useI18n()
  const query = props.query
  if (query.isPending) {
    return (
      <div className="flex justify-center py-10">
        <Spinner label={t("common.loading")} />
      </div>
    )
  }
  if (query.isError) {
    const message = props.errorMessage?.(errorTag(query.error)) ?? t("common.error")
    return (
      <EmptyState
        title={message}
        action={
          <Button size="sm" onClick={() => void query.refetch()}>
            {t("common.retry")}
          </Button>
        }
      />
    )
  }
  const items = query.data.pages.flatMap((page) => page.items)
  if (items.length === 0) return <>{props.empty}</>
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label={props.label} className="rounded-lg border border-hairline bg-surface-1">
        {items.map((lesson) => (
          <LessonRow
            key={lesson.id}
            lesson={lesson}
            showVisibility={props.showVisibility ?? false}
            actions={props.actions?.(lesson)}
          />
        ))}
      </ul>
      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            size="sm"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
            className="min-w-28"
          >
            {query.isFetchingNextPage ? (
              <Spinner size="sm" label={t("common.loading")} />
            ) : (
              t("feed.loadMore")
            )}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
