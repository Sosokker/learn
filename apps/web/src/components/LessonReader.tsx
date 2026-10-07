import type { LessonBody, LessonDetail, LessonLang } from "@app/domain"
import { LessonView } from "@app/lesson"
import { Badge, buttonClass, SegmentedControl, Skeleton, useI18n } from "@app/ui"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { toApiError } from "../lib/api.ts"
import { bodyQuery, conceptsQuery, lessonQuery, pickBody } from "../lib/queries.ts"
import { KindIcon, VisibilityBadge } from "./LessonRow.tsx"
import { TopBar } from "./Shell.tsx"
import { EmptyState, ErrorState } from "./states.tsx"

export interface LessonReaderProps {
  handle: string
  slug: string
  // From ?lang=; falls back to the UI language, then the lesson's first language.
  lang: LessonLang | undefined
  onLangChange: (lang: LessonLang) => void
  // Top bar title; the lesson title when not given.
  pageTitle?: string
}

// Loads metadata, then the body and the concept bundle in parallel, then hands them to LessonView.
export function LessonReader({ handle, slug, lang, onLangChange, pageTitle }: LessonReaderProps) {
  const { t, lang: uiLang } = useI18n()
  const detail = useQuery(lessonQuery(handle, slug))

  if (detail.isPending) {
    return (
      <>
        <TopBar title={pageTitle ?? t("common.loading")} />
        <ReaderSkeleton />
      </>
    )
  }
  if (detail.isError) {
    const notFound = toApiError(detail.error).kind === "NotFound"
    return (
      <>
        <TopBar title={pageTitle ?? (notFound ? t("lesson.notFound") : t("error.title"))} />
        {notFound ? (
          <EmptyState
            title={t("lesson.notFound")}
            body={t("lesson.notFoundBody")}
            action={
              <Link to="/explore" className={buttonClass()}>
                {t("nav.explore")}
              </Link>
            }
          />
        ) : (
          <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
        )}
      </>
    )
  }

  const lesson = detail.data
  const body = pickBody(lesson, lang ?? uiLang)
  return (
    <>
      <TopBar title={pageTitle ?? body?.title ?? lesson.title}>
        {lesson.isOwner ? (
          <Link to="/library" className={buttonClass({ variant: "ghost", size: "sm" })}>
            {t("lesson.manage")}
          </Link>
        ) : null}
      </TopBar>
      <ReaderHeader lesson={lesson} body={body} onLangChange={onLangChange} />
      {body ? (
        <ReaderBody lesson={lesson} body={body} slug={slug} />
      ) : (
        <EmptyState title={t("lesson.noBody")} />
      )}
    </>
  )
}

function ReaderHeader({
  lesson,
  body,
  onLangChange,
}: {
  lesson: LessonDetail
  body: LessonBody | undefined
  onLangChange: (lang: LessonLang) => void
}) {
  const { t, formatDate } = useI18n()
  const langs = lesson.bodies.map((b) => b.lang)
  // A compact meta bar: LessonView renders the title and summary itself.
  return (
    <div className="border-b border-hairline px-6 py-3 max-md:px-4">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 gap-y-2 text-caption text-ink-subtle">
        <Badge icon={<KindIcon kind={lesson.kind} className="size-3" />}>{t(`kind.${lesson.kind}`)}</Badge>
        {lesson.isOwner ? (
          <span title={t("lesson.ownerOnly")}>
            <VisibilityBadge visibility={lesson.visibility} />
          </span>
        ) : null}
        <span>@{lesson.owner.handle}</span>
        <span aria-hidden="true">·</span>
        <span>{t("lesson.updated", { date: formatDate(body?.createdAt ?? lesson.updatedAt) })}</span>
        {lesson.tags.length > 0 ? (
          <ul className="flex flex-wrap gap-1 md:ml-1">
            {lesson.tags.map((tag) => (
              <li key={tag}>
                <Link
                  to="/explore"
                  search={{ tag }}
                  className="inline-flex h-5 items-center rounded-sm border border-hairline bg-surface-1 px-1.5 text-caption text-ink-subtle hover:border-hairline-strong hover:text-ink"
                >
                  {tag}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {langs.length > 1 && body ? (
          <SegmentedControl<LessonLang>
            className="ml-auto"
            size="sm"
            label={t("lesson.language")}
            value={body.lang}
            onChange={onLangChange}
            options={langs.map((l) => ({
              value: l,
              label: l === "th" ? "ไทย" : "EN",
              title: t(`lessonLang.${l}`),
            }))}
          />
        ) : null}
      </div>
    </div>
  )
}

function ReaderBody({ lesson, body, slug }: { lesson: LessonDetail; body: LessonBody; slug: string }) {
  const { t, lang } = useI18n()
  const spec = useQuery(bodyQuery(lesson, body))
  const concepts = useQuery(conceptsQuery(body.versionId))

  if (spec.isError || concepts.isError) {
    return (
      <ErrorState
        title={t("lesson.bodyError")}
        error={spec.error ?? concepts.error}
        onRetry={() => {
          if (spec.isError) void spec.refetch()
          if (concepts.isError) void concepts.refetch()
        }}
      />
    )
  }
  if (spec.isPending || concepts.isPending) return <BodySkeleton />
  return (
    <div className="px-6 py-6 max-md:px-4">
      <div className="mx-auto max-w-6xl">
        <LessonView spec={spec.data} concepts={concepts.data.concepts} slug={slug} uiLang={lang} />
      </div>
    </div>
  )
}

function ReaderSkeleton() {
  const { t } = useI18n()
  return (
    <div role="status" aria-label={t("common.loading")}>
      <div className="border-b border-hairline px-6 pt-6 pb-5 max-md:px-4 max-md:pt-4">
        <div className="mx-auto flex max-w-6xl flex-col gap-3">
          <div className="flex gap-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-24" />
          </div>
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>
      </div>
      <BodySkeleton />
    </div>
  )
}

function BodySkeleton() {
  return (
    <div className="px-6 py-6 max-md:px-4" aria-hidden="true">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    </div>
  )
}
