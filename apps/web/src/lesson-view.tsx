import type { LessonLangInfo, Lesson as LessonMeta } from "@app/api"
import type { LessonLang } from "@app/domain"
import { Badge, Button, EmptyState, Select, Spinner, Tag, useI18n } from "@app/ui"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { lazy, Suspense, useState } from "react"
import { errorTag } from "./api.ts"
import { categoryPath, formatDate, kindKey, visibilityKey } from "./format.ts"
import { NotFound } from "./not-found.tsx"
import { bodyQuery, categoriesQuery, conceptBundleQuery, lessonQuery } from "./queries.ts"
import { useViewer } from "./session.ts"

// The renderer (KaTeX, React Flow, widgets) is the heaviest code in the app: load it only on a
// lesson page.
const Lesson = lazy(() => import("@app/lesson").then((module) => ({ default: module.Lesson })))

// The language to show: the one asked for, else the UI language, else the lesson's default.
function pickLang(lesson: LessonMeta, wanted: LessonLang | undefined, locale: LessonLang) {
  const has = (lang: LessonLang | undefined) => lesson.langs.find((info) => info.lang === lang)
  return has(wanted) ?? has(locale) ?? has(lesson.default_lang) ?? lesson.langs[0]
}

// A lesson page: metadata, language picker and the renderer. Used by /guide and /@handle/slug.
export function LessonView(props: {
  readonly handle: string
  readonly slug: string
  readonly lang?: LessonLang | undefined
  readonly onLangChange?: (lang: LessonLang) => void
}) {
  const { locale } = useI18n()
  const viewer = useViewer()
  const lesson = useQuery({
    ...lessonQuery(props.handle, props.slug, viewer.user?.id ?? null),
    enabled: !viewer.pending,
  })

  if (viewer.pending || lesson.isPending) return <PageSpinner />
  if (lesson.isError) {
    if (errorTag(lesson.error) === "LessonNotFound") return <NotFound />
    return <LoadError onRetry={() => void lesson.refetch()} />
  }
  const info = pickLang(lesson.data, props.lang, locale)
  if (info === undefined) return <NotFound />
  return <LessonBody lesson={lesson.data} info={info} onLangChange={props.onLangChange} />
}

function LessonBody(props: {
  readonly lesson: LessonMeta
  readonly info: LessonLangInfo
  readonly onLangChange?: ((lang: LessonLang) => void) | undefined
}) {
  const { t, locale } = useI18n()
  const { lesson, info } = props
  const body = useQuery(bodyQuery(lesson, info))
  const concepts = useQuery(conceptBundleQuery(lesson, info))
  const categories = useQuery(categoriesQuery)
  const [status, setStatus] = useState("")

  return (
    <article className="flex flex-col gap-6" lang={info.lang}>
      <header className="flex flex-col gap-3 border-b border-hairline pb-4" lang={locale}>
        <div className="flex flex-wrap items-center gap-2 text-caption text-ink-subtle">
          <Badge>{t(kindKey[lesson.kind])}</Badge>
          {lesson.visibility === "public" ? null : <Badge>{t(visibilityKey[lesson.visibility])}</Badge>}
          <span>{t("lesson.by", { author: `@${lesson.owner_handle}` })}</span>
          <span aria-hidden>·</span>
          <span>{t("lesson.updated", { date: formatDate(info.updated_at, locale) })}</span>
          <span aria-hidden>·</span>
          <span>{t("lesson.version", { n: info.n })}</span>
          {lesson.category_id === null || categories.data === undefined ? null : (
            <>
              <span aria-hidden>·</span>
              <Link
                to="/explore"
                search={{ category: lesson.category_id }}
                className="text-ink-subtle hover:text-ink"
              >
                {categoryPath(categories.data, lesson.category_id, locale)}
              </Link>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          {lesson.tags.length === 0 ? (
            <span />
          ) : (
            <ul className="flex flex-wrap gap-1.5" aria-label={t("explore.tag")}>
              {lesson.tags.map((tag) => (
                <li key={tag}>
                  <Link to="/explore" search={{ tag }} className="no-underline">
                    <Tag>{tag}</Tag>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {lesson.langs.length > 1 && props.onLangChange !== undefined ? (
            <Select
              label={t("lesson.language")}
              hideLabel
              className="w-36"
              value={info.lang}
              options={lesson.langs.map((entry) => ({ value: entry.lang, label: t(`lang.${entry.lang}`) }))}
              onValueChange={props.onLangChange}
            />
          ) : null}
        </div>
      </header>
      <p role="status" className="sr-only">
        {status}
      </p>
      {body.isError ? (
        <LoadError onRetry={() => void body.refetch()} />
      ) : body.data === undefined || concepts.isPending ? (
        <PageSpinner />
      ) : (
        <Suspense fallback={<PageSpinner />}>
          <Lesson
            spec={body.data}
            concepts={concepts.data?.items.map((item) => item.spec)}
            lang={locale}
            slug={lesson.slug}
            lessonHref={(slug) => `/@${lesson.owner_handle}/${slug}`}
            onAskPrompt={() => setStatus(t("lesson.promptCopied"))}
          />
        </Suspense>
      )}
    </article>
  )
}

export function PageSpinner() {
  const { t } = useI18n()
  return (
    <div className="flex justify-center py-16">
      <Spinner label={t("common.loading")} />
    </div>
  )
}

function LoadError(props: { readonly onRetry: () => void }) {
  const { t } = useI18n()
  return (
    <EmptyState
      title={t("lesson.loadError")}
      action={
        <Button size="sm" onClick={props.onRetry}>
          {t("common.retry")}
        </Button>
      }
    />
  )
}
