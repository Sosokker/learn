import { type LessonId, type LessonSummary, maxTags, platformPrefix, type Visibility } from "@app/api"
import { Button, buttonClass, cx, Dialog, EmptyState, Input, Select, Spinner, useI18n } from "@app/ui"
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useId, useState } from "react"
import { callApi, errorTag } from "../api.ts"
import { signInWithGoogle } from "../auth.ts"
import { ProgressList } from "../engagement.tsx"
import { categoryPath, visibilityKey } from "../format.ts"
import { BookmarkIcon, SettingsIcon } from "../icons.tsx"
import { LessonList } from "../lesson-list.tsx"
import { PageSpinner } from "../lesson-view.tsx"
import { bookmarksQuery, categoriesQuery, myLessonsKey, myLessonsQuery, progressQuery } from "../queries.ts"
import { useViewer } from "../session.ts"

const tabs = ["lessons", "bookmarks", "progress"] as const
type LibraryTab = (typeof tabs)[number]

export const Route = createFileRoute("/library")({
  // `?tab=bookmarks` / `?tab=progress`; the lessons tab is the default.
  validateSearch: (search: Record<string, unknown>): { readonly tab?: Exclude<LibraryTab, "lessons"> } =>
    search.tab === "bookmarks" || search.tab === "progress" ? { tab: search.tab } : {},
  component: LibraryPage,
})

function LibraryPage() {
  const { t } = useI18n()
  const viewer = useViewer()
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t("library.title")}</h1>
        <p className="text-body-sm text-ink-subtle">{t("library.description")}</p>
      </header>
      {viewer.pending ? (
        <PageSpinner />
      ) : viewer.user === null ? (
        <EmptyState
          title={t("library.signIn.title")}
          description={t("library.signIn.description")}
          action={
            <Button variant="primary" onClick={() => void signInWithGoogle().catch(() => undefined)}>
              {t("auth.signInWithGoogle")}
            </Button>
          }
        />
      ) : (
        <LibraryTabs userId={viewer.user.id} />
      )}
    </div>
  )
}

function LibraryTabs(props: { readonly userId: string }) {
  const { t } = useI18n()
  const search = Route.useSearch()
  const tab: LibraryTab = search.tab ?? "lessons"
  return (
    <>
      <nav
        aria-label={t("library.tabs")}
        className="-mt-2 flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-hairline)]"
      >
        {tabs.map((value) => (
          <Link
            key={value}
            to="/library"
            search={value === "lessons" ? {} : { tab: value }}
            aria-current={tab === value ? "page" : undefined}
            className={cx(
              "shrink-0 border-b-2 px-3 py-2 text-body-sm font-medium no-underline transition-colors",
              tab === value ? "border-accent text-ink" : "border-transparent text-ink-subtle hover:text-ink",
            )}
          >
            {t(`library.tab.${value}`)}
          </Link>
        ))}
      </nav>
      {tab === "lessons" ? <MyLibrary userId={props.userId} /> : null}
      {tab === "bookmarks" ? <MyBookmarks userId={props.userId} /> : null}
      {tab === "progress" ? <MyProgress userId={props.userId} /> : null}
    </>
  )
}

function MyBookmarks(props: { readonly userId: string }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const query = bookmarksQuery(props.userId)
  const bookmarks = useInfiniteQuery(query)
  // Optimistic: the row leaves the list at once and comes back if the server refuses.
  const remove = useMutation({
    mutationFn: (id: LessonId) => callApi((client) => client.engagement.unbookmark({ params: { id } })),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: query.queryKey })
      const previous = queryClient.getQueryData(query.queryKey)
      queryClient.setQueryData(query.queryKey, (old) =>
        old === undefined
          ? old
          : {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                items: page.items.filter((item) => item.id !== id),
              })),
            },
      )
      return { previous }
    },
    onError: (_error, _id, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(query.queryKey, context.previous)
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["lesson"] }),
  })
  return (
    <section aria-labelledby="library-bookmarks" className="flex flex-col gap-3">
      <h2 id="library-bookmarks" className="sr-only">
        {t("library.tab.bookmarks")}
      </h2>
      <LessonList
        query={bookmarks}
        label={t("library.tab.bookmarks")}
        errorMessage={(tag) => (tag === "Unauthenticated" ? t("error.Unauthenticated") : undefined)}
        actions={(lesson) => (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`${t("engage.removeBookmark")}: ${lesson.title}`}
            title={t("engage.removeBookmark")}
            onClick={() => remove.mutate(lesson.id)}
            className="text-accent-hover"
          >
            <BookmarkIcon filled />
          </Button>
        )}
        empty={
          <EmptyState title={t("empty.bookmarks.title")} description={t("empty.bookmarks.description")} />
        }
      />
    </section>
  )
}

function MyProgress(props: { readonly userId: string }) {
  const { t } = useI18n()
  const progress = useInfiniteQuery(progressQuery(props.userId))
  return (
    <section aria-labelledby="library-progress" className="flex flex-col gap-3">
      <h2 id="library-progress" className="sr-only">
        {t("library.tab.progress")}
      </h2>
      <ProgressList
        query={progress}
        label={t("library.tab.progress")}
        empty={
          <EmptyState
            title={t("empty.progress.title")}
            description={t("empty.progress.description")}
            action={
              <Link to="/explore" className={buttonClass("secondary", "sm")}>
                {t("nav.explore")}
              </Link>
            }
          />
        }
      />
    </section>
  )
}

function MyLibrary(props: { readonly userId: string }) {
  const { t } = useI18n()
  const lessons = useInfiniteQuery(myLessonsQuery(props.userId))
  const [editing, setEditing] = useState<LessonSummary | null>(null)
  return (
    <>
      <section className="flex flex-col gap-3">
        <LessonList
          query={lessons}
          label={t("library.tab.lessons")}
          showVisibility
          errorMessage={(tag) => (tag === "Unauthenticated" ? t("error.Unauthenticated") : undefined)}
          actions={(lesson) => (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${t("settings.open")}: ${lesson.title}`}
              onClick={() => setEditing(lesson)}
            >
              <SettingsIcon />
            </Button>
          )}
          empty={
            <EmptyState
              title={t("empty.library.title")}
              description={t("empty.library.description")}
              action={
                <Link to="/create" className={buttonClass("secondary", "sm")}>
                  {t("nav.create")}
                </Link>
              }
            />
          }
        />
      </section>
      {editing === null ? null : (
        <SettingsDialog key={editing.id} lesson={editing} onClose={() => setEditing(null)} />
      )}
    </>
  )
}

const noCategory = "__none__"

const isPlatformCategory = (id: string) => id === platformPrefix || id.startsWith(`${platformPrefix}.`)

function SettingsDialog(props: { readonly lesson: LessonSummary; readonly onClose: () => void }) {
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()
  const categories = useQuery(categoriesQuery)
  const [visibility, setVisibility] = useState<Visibility>(props.lesson.visibility)
  const [category, setCategory] = useState(props.lesson.category_id ?? noCategory)
  const [tags, setTags] = useState(props.lesson.tags.join(", "))
  const [error, setError] = useState<string | null>(null)

  const tagList = tags
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "")

  const save = useMutation({
    mutationFn: () =>
      callApi((client) =>
        client.lessons.update({
          params: { id: props.lesson.id },
          payload: { visibility, category_id: category === noCategory ? null : category, tags: tagList },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: myLessonsKey })
      void queryClient.invalidateQueries({ queryKey: ["lesson"] })
      void queryClient.invalidateQueries({ queryKey: ["feed"] })
      props.onClose()
    },
    onError: (failure) => {
      const tag = errorTag(failure)
      setError(
        tag === "InvalidSettings"
          ? t("settings.invalid")
          : tag === "Unauthenticated" || tag === "CrossSiteRequest" || tag === "RateLimited"
            ? t(`error.${tag}`)
            : t("common.error"),
      )
    },
  })

  const visibilityOptions = (["private", "unlisted", "public"] as const).map((value) => ({
    value,
    label: t(visibilityKey[value]),
  }))
  const visibilityHint = {
    private: t("visibility.privateHint"),
    unlisted: t("visibility.unlistedHint"),
    public: t("visibility.publicHint"),
  }[visibility]
  const categoryOptions = [
    { value: noCategory, label: t("settings.noCategory") },
    ...(categories.data ?? [])
      // The `platform` tree holds Learn's own guides; the server refuses it for anyone else.
      .filter((entry) => !isPlatformCategory(entry.id) || entry.id === props.lesson.category_id)
      .map((entry) => ({ value: entry.id, label: categoryPath(categories.data ?? [], entry.id, locale) }))
      .toSorted((a, b) => a.label.localeCompare(b.label, locale)),
  ]

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={`${t("settings.title")}: ${props.lesson.title}`}
      description={t("settings.description")}
      closeLabel={t("common.close")}
      footer={
        <>
          <Button onClick={props.onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            disabled={save.isPending}
            onClick={() => {
              if (tagList.length > maxTags) return setError(t("settings.tooManyTags", { max: maxTags }))
              setError(null)
              save.mutate()
            }}
          >
            {save.isPending ? <Spinner size="sm" label={t("common.loading")} /> : null}
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Select
            label={t("visibility.label")}
            options={visibilityOptions}
            value={visibility}
            onValueChange={setVisibility}
          />
          <p className="text-caption text-ink-subtle">{visibilityHint}</p>
        </div>
        <Select
          label={t("settings.category")}
          options={categoryOptions}
          value={category}
          onValueChange={setCategory}
        />
        <TagsField value={tags} onValueChange={setTags} />
        {error === null ? null : (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}

function TagsField(props: { readonly value: string; readonly onValueChange: (value: string) => void }) {
  const { t } = useI18n()
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-dense font-medium text-ink-muted">
        {t("settings.tags")}
      </label>
      <Input
        id={id}
        value={props.value}
        aria-describedby={`${id}-hint`}
        onValueChange={(value) => props.onValueChange(value)}
      />
      <p id={`${id}-hint`} className="text-caption text-ink-subtle">
        {t("settings.tagsHint", { max: maxTags })}
      </p>
    </div>
  )
}
