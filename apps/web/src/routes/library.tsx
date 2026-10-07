import {
  handlePattern,
  type Issue,
  isReservedHandle,
  type LessonSummary,
  maxTags,
  platformPrefix,
  type Visibility,
} from "@app/api"
import { maxLessonBytes } from "@app/domain"
import {
  Button,
  buttonClass,
  Card,
  Dialog,
  EmptyState,
  Input,
  Select,
  Spinner,
  TextField,
  useI18n,
} from "@app/ui"
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useId, useRef, useState } from "react"
import { callApi, errorTag } from "../api.ts"
import { signInWithGoogle } from "../auth.ts"
import { categoryPath, visibilityKey } from "../format.ts"
import { SettingsIcon, UploadIcon } from "../icons.tsx"
import { LessonList } from "../lesson-list.tsx"
import { PageSpinner } from "../lesson-view.tsx"
import { categoriesQuery, meQuery, myLessonsKey, myLessonsQuery } from "../queries.ts"
import { useViewer } from "../session.ts"

export const Route = createFileRoute("/library")({ component: LibraryPage })

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
        <MyLibrary userId={viewer.user.id} />
      )}
    </div>
  )
}

function MyLibrary(props: { readonly userId: string }) {
  const { t } = useI18n()
  const lessons = useInfiniteQuery(myLessonsQuery(props.userId))
  const [editing, setEditing] = useState<LessonSummary | null>(null)
  return (
    <>
      <ProfilePanel userId={props.userId} />
      <UploadPanel />
      <section aria-labelledby="library-list" className="flex flex-col gap-3">
        <h2 id="library-list" className="text-body font-semibold text-ink">
          {t("feed.label")}
        </h2>
        <LessonList
          query={lessons}
          label={t("feed.label")}
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
                <Link to="/guide" className={buttonClass("secondary", "sm")}>
                  {t("nav.guide")}
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

// The public handle (learn.sirin.dev/@handle). A new account gets a neutral one; this changes it.
function ProfilePanel(props: { readonly userId: string }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const me = useQuery(meQuery(props.userId))
  const current = me.data?.handle ?? null
  const [draft, setDraft] = useState<string | null>(null)
  const [message, setMessage] = useState<{ readonly ok: boolean; readonly text: string } | null>(null)
  const value = draft ?? current ?? ""

  const save = useMutation({
    mutationFn: (handle: string) => callApi((client) => client.me.update({ payload: { handle } })),
    onSuccess: (updated) => {
      queryClient.setQueryData(meQuery(props.userId).queryKey, updated)
      setDraft(null)
      setMessage({ ok: true, text: t("profile.saved", { handle: updated.handle ?? "" }) })
      // Lesson rows carry the owner's handle.
      void queryClient.invalidateQueries({ queryKey: myLessonsKey })
      void queryClient.invalidateQueries({ queryKey: ["lesson"] })
      void queryClient.invalidateQueries({ queryKey: ["feed"] })
    },
    onError: (error) => {
      const tag = errorTag(error)
      const text =
        tag === "HandleTaken"
          ? t("profile.taken")
          : tag === "InvalidHandle"
            ? t("profile.reserved")
            : tag === "Unauthenticated" || tag === "CrossSiteRequest" || tag === "RateLimited"
              ? t(`error.${tag}`)
              : t("common.error")
      setMessage({ ok: false, text })
    },
  })

  if (current === null) return null
  return (
    <Card>
      <div className="flex flex-col gap-1">
        <h2 className="text-body font-semibold text-ink">{t("profile.title")}</h2>
        <p className="text-body-sm text-ink-subtle">{t("profile.description", { handle: current })}</p>
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (value === current) return
          if (!handlePattern.test(value)) return setMessage({ ok: false, text: t("profile.invalid") })
          if (isReservedHandle(value)) return setMessage({ ok: false, text: t("profile.reserved") })
          setMessage(null)
          save.mutate(value)
        }}
      >
        <TextField
          label={t("profile.handle")}
          name="handle"
          value={value}
          onValueChange={(next) => {
            setDraft(next.toLowerCase())
            setMessage(null)
          }}
          hint={t("profile.handleHint")}
          autoComplete="off"
        />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={save.isPending || value === current}>
            {save.isPending ? <Spinner size="sm" label={t("common.loading")} /> : null}
            {t("common.save")}
          </Button>
        </div>
      </form>
      <div aria-live="polite">
        {message === null ? null : (
          <p className={`text-body-sm ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</p>
        )}
      </div>
    </Card>
  )
}

// "Train Problem.en.json" -> "train-problem-en"
function slugFromFileName(name: string) {
  return name
    .replace(/\.json$/iu, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80)
}

const slugPattern = /^[a-z0-9][a-z0-9-]{0,79}$/u

type UploadFailure =
  | { readonly kind: "message"; readonly text: string }
  | { readonly kind: "issues"; readonly issues: ReadonlyArray<Issue> }

function UploadPanel() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const fileId = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [slug, setSlug] = useState("")
  const [failure, setFailure] = useState<UploadFailure | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const upload = useMutation({
    mutationFn: async (input: { readonly file: File; readonly slug: string }) => {
      const bytes = new Uint8Array(await input.file.arrayBuffer())
      return callApi((client) => client.lessons.publish({ params: { slug: input.slug }, payload: bytes }))
    },
    onSuccess: (published) => {
      setFailure(null)
      setSuccess(
        t("upload.success", {
          title: published.lesson.title,
          n: published.version.n,
          lang: t(`lang.${published.version.lang}`),
        }),
      )
      setFile(null)
      setSlug("")
      if (fileInput.current !== null) fileInput.current.value = ""
      void queryClient.invalidateQueries({ queryKey: myLessonsKey })
      void queryClient.invalidateQueries({ queryKey: ["lesson"] })
    },
    onError: (error) => {
      setSuccess(null)
      const tag = errorTag(error)
      if (tag === "InvalidLesson" && typeof error === "object" && error !== null && "issues" in error) {
        setFailure({ kind: "issues", issues: error.issues as ReadonlyArray<Issue> })
      } else if (tag === "PayloadTooLarge") {
        setFailure({
          kind: "message",
          text: t("upload.tooLarge", { size: Math.round(maxLessonBytes / 1024) }),
        })
      } else if (tag === "Unauthenticated" || tag === "CrossSiteRequest" || tag === "RateLimited") {
        setFailure({ kind: "message", text: t(`error.${tag}`) })
      } else {
        setFailure({ kind: "message", text: t("common.error") })
      }
    },
  })

  const submit = async () => {
    setSuccess(null)
    if (file === null) return setFailure({ kind: "message", text: t("upload.chooseFile") })
    if (!slugPattern.test(slug)) return setFailure({ kind: "message", text: t("upload.slugInvalid") })
    if (file.size > maxLessonBytes) {
      return setFailure({
        kind: "message",
        text: t("upload.tooLarge", { size: Math.round(maxLessonBytes / 1024) }),
      })
    }
    // A quick local check for a clearer message; the server validates the spec itself.
    try {
      JSON.parse(await file.text())
    } catch {
      return setFailure({ kind: "message", text: t("upload.invalidJson") })
    }
    setFailure(null)
    upload.mutate({ file, slug })
  }

  return (
    <Card>
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-body font-semibold text-ink">
          <UploadIcon />
          {t("upload.title")}
        </h2>
        <p className="text-body-sm text-ink-subtle">{t("upload.description")}</p>
      </div>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={fileId} className="text-dense font-medium text-ink-muted">
            {t("upload.file")}
          </label>
          <input
            ref={fileInput}
            id={fileId}
            type="file"
            accept=".json,application/json"
            className="w-full min-w-0 text-dense text-ink-subtle file:mr-3 file:h-8 file:rounded-md file:border file:border-hairline file:bg-surface-3 file:px-3 file:text-dense file:font-medium file:text-ink hover:file:bg-surface-4"
            onChange={(event) => {
              const chosen = event.currentTarget.files?.[0] ?? null
              setFile(chosen)
              setFailure(null)
              setSuccess(null)
              if (chosen !== null) setSlug(slugFromFileName(chosen.name))
            }}
          />
        </div>
        <TextField
          label={t("upload.slug")}
          name="slug"
          value={slug}
          onValueChange={(value) => setSlug(value.toLowerCase())}
          hint={t("upload.slugHint")}
          autoComplete="off"
        />
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={upload.isPending}>
            {upload.isPending ? <Spinner size="sm" label={t("common.loading")} /> : null}
            {t("upload.submit")}
          </Button>
        </div>
        <div aria-live="polite" className="flex flex-col gap-2">
          {success === null ? null : <p className="text-body-sm text-success">{success}</p>}
          {failure === null ? null : <UploadError failure={failure} />}
        </div>
      </form>
    </Card>
  )
}

function UploadError(props: { readonly failure: UploadFailure }) {
  const { t } = useI18n()
  if (props.failure.kind === "message") {
    return <p className="text-body-sm text-danger">{props.failure.text}</p>
  }
  const issues = props.failure.issues
  return (
    <div className="flex flex-col gap-2 rounded-md border border-danger/40 bg-danger/10 p-3">
      <p className="text-body-sm font-medium text-danger">{t("upload.issues", { count: issues.length })}</p>
      <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
        {issues.map((issue) => (
          <li
            key={`${issue.path}|${issue.code}|${issue.message}`}
            className="flex min-w-0 flex-col gap-0.5 text-dense"
          >
            <span className="flex flex-wrap gap-2 font-mono text-caption">
              <code className="break-all text-ink-muted">{issue.path}</code>
              <span className="text-ink-tertiary">{issue.code}</span>
            </span>
            <span className="break-words text-ink">{issue.message}</span>
          </li>
        ))}
      </ul>
    </div>
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
