import {
  type Lesson,
  type LessonLangInfo,
  maxProgressSections,
  type ProgressItem,
  type ProgressPage,
  ProgressUpdate,
} from "@app/api"
import type { LessonProgress } from "@app/lesson"
import { Button, EmptyState, Spinner, useI18n } from "@app/ui"
import {
  type InfiniteData,
  type QueryKey,
  type UseInfiniteQueryResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import { Schema } from "effect"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { callApi, errorTag } from "./api.ts"
import { signInWithGoogle } from "./auth.ts"
import { formatDate } from "./format.ts"
import { BookmarkIcon, HeartIcon, ResumeIcon } from "./icons.tsx"
import { LessonRow } from "./lesson-list.tsx"
import { bookmarksKey, progressKey } from "./queries.ts"

// Like and bookmark buttons on a lesson page. Both update the cached lesson at once (optimistic)
// and roll back if the server refuses. Mutations of one lesson run one after another (`scope`), so
// fast repeated clicks end in the state of the last click.
export function LessonActions(props: { readonly lesson: Lesson; readonly queryKey: QueryKey }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { lesson, queryKey } = props
  const viewer = lesson.viewer
  const [error, setError] = useState<string | null>(null)

  const patch = (change: (old: Lesson) => Lesson) =>
    queryClient.setQueryData<Lesson>(queryKey, (old) => (old === undefined ? old : change(old)))

  const onFailure = (failure: unknown, previous: Lesson | undefined) => {
    if (previous !== undefined) queryClient.setQueryData(queryKey, previous)
    const tag = errorTag(failure)
    setError(
      tag === "Unauthenticated" || tag === "CrossSiteRequest" || tag === "RateLimited"
        ? t(`error.${tag}`)
        : t("engage.error"),
    )
  }

  const like = useMutation({
    scope: { id: `like-${lesson.id}` },
    mutationFn: (liked: boolean) =>
      callApi((client) =>
        liked
          ? client.engagement.like({ params: { id: lesson.id } })
          : client.engagement.unlike({ params: { id: lesson.id } }),
      ),
    onMutate: async (liked) => {
      setError(null)
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<Lesson>(queryKey)
      patch((old) =>
        old.viewer === null || old.viewer.liked === liked
          ? old
          : { ...old, like_count: old.like_count + (liked ? 1 : -1), viewer: { ...old.viewer, liked } },
      )
      return { previous }
    },
    onError: (failure, _liked, context) => onFailure(failure, context?.previous),
    onSuccess: (state) =>
      patch((old) =>
        old.viewer === null
          ? old
          : { ...old, like_count: state.like_count, viewer: { ...old.viewer, liked: state.liked } },
      ),
  })

  const bookmark = useMutation({
    scope: { id: `bookmark-${lesson.id}` },
    mutationFn: (bookmarked: boolean) =>
      callApi((client) =>
        bookmarked
          ? client.engagement.bookmark({ params: { id: lesson.id } })
          : client.engagement.unbookmark({ params: { id: lesson.id } }),
      ),
    onMutate: async (bookmarked) => {
      setError(null)
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<Lesson>(queryKey)
      patch((old) => (old.viewer === null ? old : { ...old, viewer: { ...old.viewer, bookmarked } }))
      return { previous }
    },
    onError: (failure, _bookmarked, context) => onFailure(failure, context?.previous),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: bookmarksKey }),
  })

  const signIn = () => void signInWithGoogle().catch(() => undefined)
  const liked = viewer?.liked ?? false
  const bookmarked = viewer?.bookmarked ?? false
  const likes = t("lesson.likes", { count: lesson.like_count })

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        aria-pressed={viewer === null ? undefined : liked}
        aria-label={`${t("engage.like")} (${likes})`}
        title={viewer === null ? t("engage.signIn") : likes}
        onClick={() => (viewer === null ? signIn() : like.mutate(!liked))}
        className={liked ? "border-accent/50 text-accent-hover" : ""}
      >
        <HeartIcon filled={liked} large />
        <span aria-hidden className="tabular-nums">
          {lesson.like_count}
        </span>
      </Button>
      <Button
        size="sm"
        aria-pressed={viewer === null ? undefined : bookmarked}
        title={viewer === null ? t("engage.signIn") : undefined}
        onClick={() => (viewer === null ? signIn() : bookmark.mutate(!bookmarked))}
        className={bookmarked ? "border-accent/50 text-accent-hover" : ""}
      >
        <BookmarkIcon filled={bookmarked} />
        {t(bookmarked ? "engage.bookmarked" : "engage.bookmark")}
      </Button>
      <span role="status" className="text-caption text-danger">
        {error}
      </span>
    </div>
  )
}

// "Continue where you left off": scrolls to the last section read, when there is one past the
// first and the lesson is not finished.
export function ResumeButton(props: { readonly lesson: Lesson; readonly firstSection: string | undefined }) {
  const { t } = useI18n()
  const progress = props.lesson.viewer?.progress ?? null
  if (progress === null || progress.done || progress.last === null || progress.last === props.firstSection)
    return null
  const last = progress.last
  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-accent-hover"
      onClick={() => {
        const target = document.getElementById(`section-${last}`)
        if (target === null) return
        target.scrollIntoView({ behavior: "smooth", block: "start" })
        // Move focus there too, so keyboard and screen reader users continue from that section.
        target.tabIndex = -1
        target.focus({ preventScroll: true })
      }}
    >
      <ResumeIcon />
      {t("progress.continue")}
    </Button>
  )
}

const saveEvery = 10_000
const encodeProgress = Schema.encodeSync(ProgressUpdate)

// Saves reading progress for a signed-in reader. The renderer reports every new section; this
// sends at most one request every 10 seconds, only when the progress changed since the last one
// sent, and once more when the page is hidden or left (keepalive, so it survives the unload).
// The server writes nothing for an unchanged row, and every save spends the user's write budget.
export function useProgressSaver(lesson: Lesson, info: LessonLangInfo) {
  const queryClient = useQueryClient()
  const enabled = lesson.viewer !== null
  const saved = lesson.viewer?.progress ?? null
  const pending = useRef<ProgressUpdate | null>(null)
  const sent = useRef(
    saved === null
      ? ""
      : JSON.stringify({
          version_id: saved.version_id,
          last: saved.last,
          seen: saved.seen,
          total: saved.total,
        }),
  )
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const flush = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = undefined
    const next = pending.current
    pending.current = null
    if (next === null) return
    const body = JSON.stringify(encodeProgress(next))
    if (body === sent.current) return
    sent.current = body
    void fetch(`/api/lessons/${lesson.id}/progress`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    })
      .then((response) => {
        if (!response.ok) throw new Error(`progress: HTTP ${response.status}`)
        void queryClient.invalidateQueries({ queryKey: progressKey })
      })
      .catch(() => {
        // Not saved: let the next report try again.
        sent.current = ""
      })
  }, [lesson.id, queryClient])

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush()
    }
    document.addEventListener("visibilitychange", onHide)
    window.addEventListener("pagehide", flush)
    return () => {
      document.removeEventListener("visibilitychange", onHide)
      window.removeEventListener("pagehide", flush)
      flush()
    }
  }, [flush])

  const onProgress = useCallback(
    (progress: LessonProgress) => {
      pending.current = {
        version_id: info.version_id,
        last: progress.last,
        seen: progress.seen.slice(0, maxProgressSections),
        total: Math.min(Math.max(progress.total, 1), maxProgressSections),
      }
      timer.current ??= setTimeout(flush, saveEvery)
    },
    [info.version_id, flush],
  )

  return enabled ? { seen: saved?.seen ?? [], onProgress } : undefined
}

function ProgressBar(props: { readonly item: ProgressItem }) {
  const { t, locale } = useI18n()
  const { progress } = props.item
  const percent = Math.min(100, Math.round((100 * progress.seen.length) / Math.max(progress.total, 1)))
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-subtle">
      <span
        className="h-1 w-24 overflow-hidden rounded-full bg-surface-4"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={t("progress.percent", { percent })}
      >
        <span className="block h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
      </span>
      <span>{t("progress.percent", { percent })}</span>
      <span>{t("progress.lastRead", { date: formatDate(progress.updated_at, locale) })}</span>
    </div>
  )
}

// "Continue learning" rows: each lesson with how much was read, opening in the language read.
export function ProgressList(props: {
  readonly query: UseInfiniteQueryResult<InfiniteData<ProgressPage>>
  readonly label: string
  readonly empty: ReactNode
  readonly paged?: boolean
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
    const tag = errorTag(query.error)
    return (
      <EmptyState
        title={tag === "Unauthenticated" ? t("error.Unauthenticated") : t("common.error")}
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
        {items.map((item) => (
          <LessonRow
            key={item.lesson.id}
            lesson={item.lesson}
            lang={item.progress.lang}
            extra={<ProgressBar item={item} />}
          />
        ))}
      </ul>
      {props.paged !== false && query.hasNextPage ? (
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
