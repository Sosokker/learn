import {
  type Comment,
  type CommentAnchor,
  type CommentId,
  type Lesson,
  type LessonVersionId,
  maxCommentLength,
  type ReportTargetType,
} from "@app/api"
import type { LessonLang, LessonSpec } from "@app/domain"
import { type AnchorInfo, buildModel, describeAnchor, lessonAnchor } from "@app/lesson"
import { Badge, Button, cx, Dialog, EmptyState, Menu, MenuItem, Spinner, useI18n } from "@app/ui"
import { type QueryKey, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react"
import { callApi, errorTag } from "./api.ts"
import { signInWithGoogle } from "./auth.ts"
import { formatDate } from "./format.ts"
import { commentsKey, commentsQuery } from "./queries.ts"
import { ReportDialog } from "./report.tsx"

// The comments of a lesson, in a dialog opened from the lesson header (the whole lesson), the
// inspector's "Comments" button or an ask-bar chip (one piece). Comments are plain text: the body
// is rendered as a React text node, never parsed (ADR 0004). This module loads with the renderer,
// since it describes anchors with the renderer's model.

export interface CommentsTarget {
  // The piece the dialog opened on; new comments go there.
  readonly anchor: CommentAnchor
  readonly scope: "piece" | "all"
}

export function CommentsPanel(props: {
  readonly target: CommentsTarget | null
  readonly onClose: () => void
  readonly lesson: Lesson
  readonly lessonQueryKey: QueryKey
  readonly spec: LessonSpec
  readonly versionId: LessonVersionId
  readonly lang: LessonLang
  readonly viewerId: string | null
  readonly isAdmin: boolean
  readonly onStatus: (message: string) => void
}) {
  const { t } = useI18n()
  const model = useMemo(
    () => buildModel({ spec: props.spec, slug: props.lesson.slug }),
    [props.spec, props.lesson.slug],
  )
  const target = props.target
  const focus = target === null ? undefined : describeAnchor(model, target.anchor)
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t("comments.title")}
      description={
        target === null || target.anchor === lessonAnchor ? undefined : <AnchorLabel info={focus} />
      }
      closeLabel={t("common.close")}
    >
      {target === null ? null : (
        <PanelBody {...props} target={target} describe={(anchor) => describeAnchor(model, anchor)} />
      )}
    </Dialog>
  )
}

function AnchorLabel(props: { readonly info: AnchorInfo | undefined }) {
  const { t } = useI18n()
  if (props.info === undefined) return <span className="italic">{t("comments.anchorGone")}</span>
  if (props.info.anchor === lessonAnchor) return <span>{t("comments.onLesson")}</span>
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-2">
      <code className="font-mono text-caption text-ink-muted">{props.info.name}</code>
      <span className="min-w-0 break-words">{props.info.title}</span>
    </span>
  )
}

type Moderation = { readonly owner: boolean; readonly admin: boolean }

function PanelBody(props: {
  readonly target: CommentsTarget
  readonly lesson: Lesson
  readonly lessonQueryKey: QueryKey
  readonly versionId: LessonVersionId
  readonly lang: LessonLang
  readonly viewerId: string | null
  readonly isAdmin: boolean
  readonly onStatus: (message: string) => void
  readonly describe: (anchor: string) => AnchorInfo | undefined
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [scope, setScope] = useState(props.target.scope)
  const [report, setReport] = useState<{ readonly type: ReportTargetType; readonly id: string } | null>(null)
  const anchor = props.target.anchor
  const piece = anchor !== lessonAnchor && scope === "piece"
  const listAnchor = piece ? anchor : undefined
  const comments = useInfiniteQuery(commentsQuery(props.lesson.id, listAnchor, props.viewerId))
  const moderation: Moderation = { owner: props.lesson.is_owner, admin: props.isAdmin }

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: commentsKey(props.lesson.id) }),
      queryClient.invalidateQueries({ queryKey: props.lessonQueryKey }),
    ])

  const threads = comments.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {anchor === lessonAnchor ? null : (
        <fieldset className="flex items-center gap-2">
          <legend className="sr-only">{t("comments.scope")}</legend>
          {(["piece", "all"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={scope === value ? "secondary" : "ghost"}
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
            >
              {t(`comments.scope.${value}`)}
            </Button>
          ))}
        </fieldset>
      )}
      <Composer
        lesson={props.lesson}
        versionId={props.versionId}
        anchor={anchor}
        parentId={undefined}
        signedIn={props.viewerId !== null}
        onPosted={() => {
          props.onStatus(t("comments.posted"))
          return refresh()
        }}
      />
      {comments.isPending ? (
        <div className="flex justify-center py-6">
          <Spinner label={t("common.loading")} />
        </div>
      ) : comments.isError ? (
        <EmptyState
          title={t("comments.loadError")}
          action={
            <Button size="sm" onClick={() => void comments.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : threads.length === 0 ? (
        <EmptyState title={t("comments.empty.title")} description={t("comments.empty.description")} />
      ) : (
        <ol className="flex flex-col gap-4">
          {threads.map((thread) => (
            <li key={thread.id} className="flex flex-col gap-2 border-t border-hairline pt-3">
              <CommentItem
                comment={thread}
                showAnchor={!piece}
                describe={props.describe}
                lesson={props.lesson}
                lang={props.lang}
                versionId={props.versionId}
                signedIn={props.viewerId !== null}
                moderation={moderation}
                onReport={(id) => setReport({ type: "comment", id })}
                onChanged={refresh}
                canReply={thread.status === "visible"}
              />
              {thread.replies.length === 0 ? null : (
                <ol className="ml-3 flex flex-col gap-3 border-l border-hairline pl-3">
                  {thread.replies.map((reply) => (
                    <li key={reply.id}>
                      <CommentItem
                        comment={reply}
                        showAnchor={false}
                        describe={props.describe}
                        lesson={props.lesson}
                        lang={props.lang}
                        versionId={props.versionId}
                        signedIn={props.viewerId !== null}
                        moderation={moderation}
                        onReport={(id) => setReport({ type: "comment", id })}
                        onChanged={refresh}
                        canReply={false}
                      />
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ol>
      )}
      {comments.hasNextPage ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={comments.isFetchingNextPage}
          onClick={() => void comments.fetchNextPage()}
        >
          {t("comments.loadMore")}
        </Button>
      ) : null}
      <ReportDialog target={report} onClose={() => setReport(null)} onSent={props.onStatus} />
    </div>
  )
}

function useCommentError() {
  const { t } = useI18n()
  return (failure: unknown) => {
    const tag = errorTag(failure)
    if (tag === "Unauthenticated" || tag === "CrossSiteRequest" || tag === "RateLimited")
      return t(`error.${tag}`)
    if (tag === "InvalidComment" || tag === "CommentNotFound") return t("comments.invalid")
    return t("comments.error")
  }
}

function Composer(props: {
  readonly lesson: Lesson
  readonly versionId: LessonVersionId
  readonly anchor: CommentAnchor
  readonly parentId: CommentId | undefined
  readonly signedIn: boolean
  readonly onPosted: () => Promise<unknown>
  readonly onCancel?: () => void
}) {
  const { t } = useI18n()
  const errorText = useCommentError()
  const [body, setBody] = useState("")
  const [error, setError] = useState<string | null>(null)
  const fieldId = useId()
  const field = useRef<HTMLTextAreaElement>(null)
  const isReply = props.parentId !== undefined
  // A reply box opens from a click on "Reply": put the caret in it.
  useEffect(() => {
    if (isReply) field.current?.focus()
  }, [isReply])
  const post = useMutation({
    mutationFn: (text: string) =>
      callApi((client) =>
        client.comments.create({
          params: { id: props.lesson.id },
          payload: {
            version_id: props.versionId,
            anchor: props.anchor,
            body: text,
            ...(props.parentId === undefined ? {} : { parent_id: props.parentId }),
          },
        }),
      ),
    onSuccess: () => {
      setBody("")
      return props.onPosted()
    },
    onError: (failure) => setError(errorText(failure)),
  })

  if (!props.signedIn) {
    return props.parentId === undefined ? (
      <Button className="self-start" onClick={() => void signInWithGoogle().catch(() => undefined)}>
        {t("comments.signIn")}
      </Button>
    ) : null
  }
  const text = body.trim()
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (text === "" || post.isPending) return
        setError(null)
        post.mutate(text)
      }}
    >
      <label htmlFor={fieldId} className="sr-only">
        {t("comments.label")}
      </label>
      <textarea
        ref={field}
        id={fieldId}
        value={body}
        maxLength={maxCommentLength}
        rows={props.parentId === undefined ? 3 : 2}
        placeholder={
          props.parentId === undefined ? t("comments.placeholder") : t("comments.replyPlaceholder")
        }
        onChange={(event) => setBody(event.currentTarget.value)}
        className="min-h-16 w-full resize-y rounded-md border border-hairline bg-surface-1 px-3 py-2 text-body-sm text-ink placeholder:text-ink-tertiary hover:border-hairline-strong focus-visible:border-accent focus-visible:outline-none"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption text-ink-tertiary" aria-live="polite">
          {body.length > maxCommentLength * 0.8
            ? t("comments.chars", { count: body.length, max: maxCommentLength })
            : ""}
        </span>
        <div className="flex gap-2">
          {props.onCancel === undefined ? null : (
            <Button size="sm" variant="ghost" onClick={props.onCancel}>
              {t("common.cancel")}
            </Button>
          )}
          <Button size="sm" variant="primary" type="submit" disabled={text === "" || post.isPending}>
            {props.parentId === undefined ? t("comments.post") : t("comments.reply")}
          </Button>
        </div>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}
    </form>
  )
}

function CommentItem(props: {
  readonly comment: Comment
  readonly showAnchor: boolean
  readonly describe: (anchor: string) => AnchorInfo | undefined
  readonly lesson: Lesson
  readonly lang: LessonLang
  readonly versionId: LessonVersionId
  readonly signedIn: boolean
  readonly moderation: Moderation
  readonly onReport: (id: CommentId) => void
  readonly onChanged: () => Promise<unknown>
  readonly canReply: boolean
}) {
  const { t, locale } = useI18n()
  const errorText = useCommentError()
  const { comment, lesson } = props
  const [mode, setMode] = useState<"view" | "edit" | "reply" | "confirmDelete">("view")
  const [draft, setDraft] = useState(comment.body)
  const [error, setError] = useState<string | null>(null)
  const editId = useId()
  const editField = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (mode === "edit") editField.current?.focus()
  }, [mode])

  const change = useMutation({
    mutationFn: (action: "edit" | "delete" | "hide" | "unhide"): Promise<unknown> => {
      const params = { id: lesson.id, commentId: comment.id }
      // An admin who does not own the lesson moderates through the admin endpoints.
      const asAdmin = !props.moderation.owner && props.moderation.admin
      return callApi((client) => {
        switch (action) {
          case "edit":
            return client.comments.update({ params, payload: { body: draft.trim() } })
          case "delete":
            return client.comments.delete({ params })
          case "hide":
            return asAdmin
              ? client.admin.hideComment({ params: { id: comment.id } })
              : client.comments.hide({ params })
          case "unhide":
            return asAdmin
              ? client.admin.unhideComment({ params: { id: comment.id } })
              : client.comments.unhide({ params })
        }
      })
    },
    onSuccess: () => {
      setMode("view")
      setError(null)
      return props.onChanged()
    },
    onError: (failure) => setError(errorText(failure)),
  })

  if (comment.status === "deleted" || comment.status === "removed") {
    return (
      <p className="text-body-sm italic text-ink-tertiary">
        {comment.status === "deleted" ? t("comments.deleted") : t("comments.removed")}
      </p>
    )
  }

  const moderator = props.moderation.owner || props.moderation.admin
  // The owner cannot undo a moderator's hide; the server would leave it hidden.
  const canUnhide =
    comment.status === "hidden" &&
    (props.moderation.admin || (props.moderation.owner && comment.hidden_by === "owner"))
  const actions: ReadonlyArray<{
    readonly key: string
    readonly label: string
    readonly run: () => void
    readonly danger?: boolean
  }> = [
    ...(comment.is_author
      ? [
          {
            key: "edit",
            label: t("comments.edit"),
            run: () => {
              setDraft(comment.body)
              setMode("edit")
            },
          },
          { key: "delete", label: t("common.delete"), run: () => setMode("confirmDelete"), danger: true },
        ]
      : []),
    ...(moderator && comment.status === "visible"
      ? [{ key: "hide", label: t("comments.hide"), run: () => change.mutate("hide") }]
      : []),
    ...(canUnhide
      ? [{ key: "unhide", label: t("comments.unhide"), run: () => change.mutate("unhide") }]
      : []),
    ...(props.signedIn && !comment.is_author && comment.status === "visible"
      ? [{ key: "report", label: t("comments.report"), run: () => props.onReport(comment.id) }]
      : []),
  ]
  const info =
    props.showAnchor && comment.anchor !== lessonAnchor ? props.describe(comment.anchor) : undefined

  return (
    <article className={cx("flex min-w-0 flex-col gap-1.5", comment.status === "hidden" && "opacity-80")}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-subtle">
        <span className="font-medium text-ink-muted">@{comment.author_handle}</span>
        <span aria-hidden>·</span>
        <time dateTime={new Date(comment.created_at).toISOString()}>
          {formatDate(comment.created_at, locale)}
        </time>
        {comment.edited_at === null ? null : <span>({t("comments.edited")})</span>}
        {comment.lang === props.lang ? null : <Badge>{t(`lang.${comment.lang}`)}</Badge>}
        {comment.status === "hidden" ? <Badge tone="danger">{t("comments.hidden")}</Badge> : null}
      </header>
      {props.showAnchor && comment.anchor !== lessonAnchor ? (
        <p className="text-caption text-ink-subtle">
          {info === undefined ? (
            <span className="italic">{t("comments.anchorGone")}</span>
          ) : (
            <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-2">
              <code className="font-mono text-ink-muted">{info.name}</code>
              <span className="min-w-0 break-words">{info.title}</span>
            </span>
          )}
        </p>
      ) : null}
      {mode === "edit" ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (draft.trim() === "") return
            change.mutate("edit")
          }}
        >
          <label htmlFor={editId} className="sr-only">
            {t("comments.edit")}
          </label>
          <textarea
            ref={editField}
            id={editId}
            value={draft}
            maxLength={maxCommentLength}
            rows={3}
            onChange={(event) => setDraft(event.currentTarget.value)}
            className="w-full resize-y rounded-md border border-hairline bg-surface-1 px-3 py-2 text-body-sm text-ink focus-visible:border-accent focus-visible:outline-none"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setMode("view")}>
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              type="submit"
              disabled={draft.trim() === "" || change.isPending}
            >
              {t("common.save")}
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-body-sm break-words whitespace-pre-wrap text-ink">{comment.body}</p>
      )}
      {comment.status === "hidden" ? (
        <p className="text-caption text-ink-subtle">
          {comment.hidden_by === "admin" ? t("comments.hiddenBy.admin") : t("comments.hiddenBy.owner")}
        </p>
      ) : null}
      {mode === "confirmDelete" ? (
        <div
          role="alertdialog"
          aria-label={t("comments.deleteTitle")}
          className="flex flex-wrap items-center gap-2"
        >
          <span className="text-body-sm text-ink-muted">{t("comments.deleteDescription")}</span>
          <Button size="sm" variant="ghost" onClick={() => setMode("view")}>
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={change.isPending}
            onClick={() => change.mutate("delete")}
          >
            {t("common.delete")}
          </Button>
        </div>
      ) : mode === "view" ? (
        <Toolbar>
          {props.canReply && props.signedIn ? (
            <Button size="sm" variant="ghost" onClick={() => setMode("reply")}>
              {t("comments.reply")}
            </Button>
          ) : null}
          {actions.length === 0 ? null : (
            <Menu
              align="end"
              trigger={
                <Button size="sm" variant="ghost" aria-label={t("comments.actions")}>
                  <span aria-hidden>···</span>
                </Button>
              }
            >
              {actions.map((action) => (
                <MenuItem key={action.key} onClick={action.run} danger={action.danger === true}>
                  {action.label}
                </MenuItem>
              ))}
            </Menu>
          )}
        </Toolbar>
      ) : null}
      {mode === "reply" ? (
        <Composer
          lesson={lesson}
          versionId={props.versionId}
          anchor={comment.anchor}
          parentId={comment.id}
          signedIn={props.signedIn}
          onCancel={() => setMode("view")}
          onPosted={() => {
            setMode("view")
            return props.onChanged()
          }}
        />
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}
    </article>
  )
}

function Toolbar(props: { readonly children: ReactNode }) {
  return <div className="-ml-2 flex items-center gap-1">{props.children}</div>
}
