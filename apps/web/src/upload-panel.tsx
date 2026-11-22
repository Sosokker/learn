import { InvalidLesson, type Issue } from "@app/api"
import { maxLessonBytes } from "@app/domain"
import { Button, Spinner, TextField, useI18n } from "@app/ui"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Schema } from "effect"
import { useId, useRef, useState } from "react"
import { callApi, errorTag } from "./api.ts"
import { myLessonsKey } from "./queries.ts"

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

// The manual publish path, used when no agent is available. The page around it owns the heading.
export function UploadForm() {
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
      if (Schema.is(InvalidLesson)(error)) {
        setFailure({ kind: "issues", issues: error.issues })
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
