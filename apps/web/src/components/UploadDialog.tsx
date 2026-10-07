import { LessonSlug, LessonSpec, type LessonSummary, maxLessonBytes } from "@app/domain"
import { Button, CheckIcon, Dialog, Field, Input, UploadIcon, useI18n, useToast } from "@app/ui"
import { useQueryClient } from "@tanstack/react-query"
import { Result, Schema, SchemaIssue } from "effect"
import { useId, useRef, useState } from "react"
import { type ApiError, call, errorMessage, type Issue, toApiError } from "../lib/api.ts"
import { formatPath, IssueList } from "./IssueList.tsx"
import { KindIcon } from "./LessonRow.tsx"

type Parsed =
  | { readonly status: "ok"; readonly spec: LessonSpec; readonly fileName: string }
  | {
      readonly status: "error"
      readonly message: string
      readonly issues: ReadonlyArray<Issue>
      readonly fileName: string
    }

const decodeSpec = Schema.decodeUnknownResult(LessonSpec, { errors: "all" })
const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1()
const isSlug = Schema.is(LessonSlug)

// A slug from the title. Thai titles have no Latin letters, so they fall back to "lesson".
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "")
  return slug || "lesson"
}

export function UploadDialog({
  open,
  onOpenChange,
  handle,
  target,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  handle: string
  // Set to add a version or translation to this lesson; unset to create a new lesson.
  target?: LessonSummary | undefined
}) {
  const { t } = useI18n()
  const toast = useToast()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const fileInputId = useId()
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [slug, setSlug] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<ApiError | null>(null)

  const reset = () => {
    setParsed(null)
    setSlug("")
    setNote("")
    setServerError(null)
    setBusy(false)
    if (fileInput.current) fileInput.current.value = ""
  }

  const onFile = async (file: File | undefined) => {
    setServerError(null)
    if (!file) return
    const fileName = file.name
    if (file.size > maxLessonBytes) {
      setParsed({ status: "error", message: t("upload.tooBig"), issues: [], fileName })
      return
    }
    let json: unknown
    try {
      json = JSON.parse(await file.text())
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setParsed({ status: "error", message: t("upload.notJson", { message }), issues: [], fileName })
      return
    }
    const result = decodeSpec(json)
    if (Result.isFailure(result)) {
      const issues = formatIssues(result.failure.issue).issues.map((i) => ({
        path: formatPath(i.path ?? []),
        message: i.message,
      }))
      setParsed({ status: "error", message: t("upload.schemaErrors"), issues, fileName })
      return
    }
    setParsed({ status: "ok", spec: result.success, fileName })
    if (!target) setSlug(slugify(result.success.title))
  }

  const slugValid = isSlug(slug)
  const canSubmit = parsed?.status === "ok" && (target !== undefined || slugValid) && !busy

  const submit = async () => {
    if (parsed?.status !== "ok") return
    setBusy(true)
    setServerError(null)
    const noteValue = note.trim()
    const extra = noteValue ? { note: noteValue.slice(0, 200) } : {}
    try {
      if (target) {
        await call((c) =>
          c.lessons.addVersion({ params: { id: target.id }, payload: { spec: parsed.spec, ...extra } }),
        )
        toast(t("upload.versionAdded"), "success")
      } else {
        await call((c) => c.lessons.create({ payload: { slug, spec: parsed.spec, ...extra } }))
        toast(t("upload.created"), "success")
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["library"] }),
        queryClient.invalidateQueries({ queryKey: ["lesson"] }),
        queryClient.invalidateQueries({ queryKey: ["feed"] }),
      ])
      reset()
      onOpenChange(false)
    } catch (e) {
      setServerError(toApiError(e))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
      size="lg"
      title={target ? t("upload.addTitle", { title: target.title }) : t("upload.title")}
      description={target ? t("upload.addDescription") : t("upload.description")}
      closeLabel={t("common.close")}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>
            {busy ? t("upload.uploading") : target ? t("upload.submitVersion") : t("upload.submit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-dense font-medium text-ink-muted">{t("upload.file")}</span>
          <input
            ref={fileInput}
            id={fileInputId}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <label
            htmlFor={fileInputId}
            className="flex h-16 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-hairline-strong bg-surface-1 px-4 text-dense text-ink-subtle transition-colors duration-100 hover:border-hairline-tertiary hover:text-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary-focus/50"
          >
            <UploadIcon />
            <span className="truncate">
              {parsed ? `${parsed.fileName} · ${t("upload.change")}` : t("upload.choose")}
            </span>
          </label>
        </div>

        {parsed?.status === "error" ? <IssueList title={parsed.message} issues={parsed.issues} /> : null}

        {parsed?.status === "ok" ? (
          <div className="flex items-center gap-3 rounded-md border border-hairline bg-surface-1 px-3 py-2.5">
            <KindIcon kind={parsed.spec.kind} className="shrink-0 text-ink-subtle" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-dense font-medium text-ink" lang={parsed.spec.lang}>
                {parsed.spec.title}
              </span>
              <span className="text-caption text-ink-subtle">
                {t(`kind.${parsed.spec.kind}`)} · {t(`lessonLang.${parsed.spec.lang}`)}
              </span>
            </div>
            <span className="flex shrink-0 items-center gap-1 text-caption text-success">
              <CheckIcon className="size-3.5" />
              {t("upload.ok")}
            </span>
          </div>
        ) : null}

        {parsed?.status === "ok" && !target ? (
          <Field
            label={t("upload.slug")}
            hint={t("upload.slugHint", { handle, slug: slug || "…" })}
            error={
              serverError?.kind === "Conflict"
                ? t("upload.slugTaken")
                : slug && !slugValid
                  ? t("upload.slugInvalid")
                  : undefined
            }
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={(slug.length > 0 && !slugValid) || serverError?.kind === "Conflict"}
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                autoCapitalize="none"
                spellCheck={false}
                className="font-mono"
              />
            )}
          </Field>
        ) : null}

        {parsed?.status === "ok" ? (
          <Field label={t("upload.note")}>
            {({ id }) => (
              <Input
                id={id}
                value={note}
                maxLength={200}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("upload.notePlaceholder")}
              />
            )}
          </Field>
        ) : null}

        {serverError && serverError.kind === "Invalid" ? (
          <IssueList
            title={
              serverError.message
                ? `${t("upload.serverIssues")} ${serverError.message}`
                : t("upload.serverIssues")
            }
            issues={serverError.issues}
          />
        ) : serverError && serverError.kind !== "Conflict" ? (
          <p role="alert" className="text-dense text-danger">
            {errorMessage(t, serverError)}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
