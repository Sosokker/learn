import { type CategoryId, type LessonSummary, maxTags, TagSlug, type Visibility } from "@app/domain"
import { Button, Chip, Dialog, Field, SegmentedControl, Select, useI18n, useToast } from "@app/ui"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Schema } from "effect"
import { type KeyboardEvent, useId, useMemo, useState } from "react"
import { type ApiError, call, errorMessage, toApiError } from "../lib/api.ts"
import { buildTree, categoryOptions } from "../lib/categories.ts"
import { categoriesQuery, tagsQuery } from "../lib/queries.ts"
import { IssueList } from "./IssueList.tsx"

const isTag = Schema.is(TagSlug)

// Tags are slugs: lowercase, spaces become dashes. The server normalizes too; this keeps the chip
// the user sees equal to what is saved.
const normalizeTag = (raw: string) => raw.trim().toLowerCase().normalize("NFC").replace(/\s+/g, "-")

export function DetailsDialog({
  lesson,
  onOpenChange,
}: {
  lesson: LessonSummary | null
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  return (
    <Dialog
      open={lesson !== null}
      onOpenChange={onOpenChange}
      title={t("details.title")}
      description={lesson?.title}
      closeLabel={t("common.close")}
    >
      {/* Keyed so the form starts from the lesson's saved values each time it opens. */}
      {lesson ? <DetailsForm key={lesson.id} lesson={lesson} onDone={() => onOpenChange(false)} /> : null}
    </Dialog>
  )
}

function DetailsForm({ lesson, onDone }: { lesson: LessonSummary; onDone: () => void }) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const queryClient = useQueryClient()
  const categories = useQuery(categoriesQuery)
  const tree = useMemo(() => (categories.data ? buildTree(categories.data) : []), [categories.data])

  const [visibility, setVisibility] = useState<Visibility>(lesson.visibility)
  const [categoryId, setCategoryId] = useState<string>(lesson.categoryId ?? "")
  const [tags, setTags] = useState<ReadonlyArray<string>>(lesson.tags)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const save = async () => {
    setBusy(true)
    setError(null)
    // Send only what changed, so a visibility change doesn't also rewrite tags.
    const sameTags = tags.length === lesson.tags.length && tags.every((tag, i) => tag === lesson.tags[i])
    const payload = {
      ...(visibility !== lesson.visibility ? { visibility } : {}),
      ...(categoryId !== (lesson.categoryId ?? "")
        ? { categoryId: categoryId ? (categoryId as CategoryId) : null }
        : {}),
      ...(sameTags ? {} : { tags }),
    }
    try {
      if (Object.keys(payload).length > 0) {
        await call((c) => c.lessons.update({ params: { id: lesson.id }, payload }))
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["library"] }),
          queryClient.invalidateQueries({ queryKey: ["lesson"] }),
          queryClient.invalidateQueries({ queryKey: ["feed"] }),
        ])
        toast(t("library.saved"), "success")
      }
      onDone()
    } catch (e) {
      setError(toApiError(e))
      setBusy(false)
    }
  }

  const visibilityHint =
    visibility === "public"
      ? t("visibility.publicHint")
      : visibility === "unlisted"
        ? t("visibility.unlistedHint")
        : t("visibility.privateHint")
  const publicIncomplete = visibility === "public" && (!categoryId || tags.length === 0)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <span className="text-dense font-medium text-ink-muted">{t("details.visibility")}</span>
        <SegmentedControl<Visibility>
          label={t("details.visibility")}
          value={visibility}
          onChange={setVisibility}
          className="self-start"
          options={[
            { value: "private", label: t("visibility.private") },
            { value: "unlisted", label: t("visibility.unlisted") },
            { value: "public", label: t("visibility.public") },
          ]}
        />
        <p className={publicIncomplete ? "text-caption text-ink-muted" : "text-caption text-ink-subtle"}>
          {visibilityHint}
        </p>
      </div>

      <Field label={t("details.category")}>
        {({ id }) => (
          <Select
            id={id}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            options={[{ value: "", label: t("details.noCategory") }, ...categoryOptions(tree, lang)]}
            className="w-full"
          />
        )}
      </Field>

      <TagInput tags={tags} onChange={setTags} />

      {error?.kind === "Invalid" ? (
        <IssueList title={error.message || t("error.invalid")} issues={error.issues} />
      ) : error ? (
        <p role="alert" className="text-dense text-danger">
          {errorMessage(t, error)}
        </p>
      ) : null}

      <div className="flex justify-end gap-2 border-t border-hairline pt-4">
        <Button variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" onClick={save} disabled={busy}>
          {busy ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </div>
  )
}

function TagInput({
  tags,
  onChange,
}: {
  tags: ReadonlyArray<string>
  onChange: (tags: ReadonlyArray<string>) => void
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const listId = useId()
  const inputId = useId()
  const hintId = useId()
  const prefix = normalizeTag(draft)
  const suggestions = useQuery({ ...tagsQuery(prefix), enabled: tags.length < maxTags })

  const add = (raw: string) => {
    const tag = normalizeTag(raw).replace(/,+$/, "")
    if (!tag) return
    if (tags.includes(tag)) {
      setDraft("")
      return
    }
    if (tags.length >= maxTags) {
      setProblem(t("details.tagsFull"))
      return
    }
    if (!isTag(tag)) {
      setProblem(t("details.badTag"))
      return
    }
    onChange([...tags, tag])
    setDraft("")
    setProblem(null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      add(draft)
    } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      onChange(tags.slice(0, -1))
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-dense font-medium text-ink-muted">
        {t("details.tags")}
      </label>
      <div className="flex min-h-8 flex-wrap items-center gap-1 rounded-md border border-hairline bg-surface-1 px-1.5 py-1 transition-colors duration-100 focus-within:border-hairline-strong hover:border-hairline-strong has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-primary-focus/50">
        {tags.map((tag) => (
          <Chip
            key={tag}
            onRemove={() => onChange(tags.filter((x) => x !== tag))}
            removeLabel={t("details.removeTag", { tag })}
          >
            {tag}
          </Chip>
        ))}
        <input
          id={inputId}
          value={draft}
          onChange={(e) => {
            const value = e.target.value
            // Picking a datalist option fires a change with the full value: add it right away.
            if (suggestions.data?.some((s) => s.slug === value)) add(value)
            else setDraft(value)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft)}
          list={listId}
          disabled={tags.length >= maxTags}
          placeholder={tags.length >= maxTags ? "" : t("details.tagPlaceholder")}
          aria-describedby={hintId}
          autoCapitalize="none"
          spellCheck={false}
          className="h-6 min-w-24 flex-1 bg-transparent px-1 text-body-sm text-ink placeholder:text-ink-tertiary focus:outline-none max-md:text-body"
        />
        <datalist id={listId}>
          {(suggestions.data ?? [])
            .filter((s) => !tags.includes(s.slug))
            .map((s) => (
              <option key={s.slug} value={s.slug} label={t("details.lessons", { n: s.lessonCount })} />
            ))}
        </datalist>
      </div>
      <p id={hintId} className={problem ? "text-caption text-danger" : "text-caption text-ink-subtle"}>
        {problem ?? (tags.length >= maxTags ? t("details.tagsFull") : t("details.tagsHint"))}
      </p>
    </div>
  )
}
