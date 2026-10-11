import { maxReportNote, type ReportReason, type ReportTargetType } from "@app/api"
import { Button, Dialog, Select, TextField, useI18n } from "@app/ui"
import { useMutation } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { callApi, errorTag } from "./api.ts"

const reasons: ReadonlyArray<ReportReason> = ["spam", "abuse", "wrong", "other"]

// Report a lesson or a comment to the moderators. A second report of the same target by the same
// user changes nothing on the server, so sending twice is harmless.
export function ReportDialog(props: {
  readonly target: { readonly type: ReportTargetType; readonly id: string } | null
  readonly onClose: () => void
  readonly onSent: (message: string) => void
}) {
  const { t } = useI18n()
  const [reason, setReason] = useState<ReportReason>("spam")
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const target = props.target
  // The title stays while the dialog animates closed, after the target is gone.
  const lastType = useRef<ReportTargetType>("lesson")
  if (target !== null) lastType.current = target.type

  const send = useMutation({
    mutationFn: (input: { readonly type: ReportTargetType; readonly id: string }) =>
      callApi((client) =>
        client.reports.create({
          payload: {
            target_type: input.type,
            target_id: input.id,
            reason,
            ...(note.trim() === "" ? {} : { note: note.trim().slice(0, maxReportNote) }),
          },
        }),
      ),
    onSuccess: () => {
      setNote("")
      setReason("spam")
      props.onClose()
      props.onSent(t("report.sent"))
    },
    onError: (failure) => {
      const tag = errorTag(failure)
      setError(
        tag === "Unauthenticated" || tag === "CrossSiteRequest" || tag === "RateLimited"
          ? t(`error.${tag}`)
          : t("report.error"),
      )
    },
  })

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          setError(null)
          props.onClose()
        }
      }}
      title={lastType.current === "comment" ? t("report.commentTitle") : t("report.lessonTitle")}
      description={t("report.description")}
      closeLabel={t("common.close")}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={send.isPending || target === null}
            onClick={() => {
              if (target === null) return
              setError(null)
              send.mutate(target)
            }}
          >
            {t("report.send")}
          </Button>
        </>
      }
    >
      <Select
        label={t("report.reason")}
        value={reason}
        options={reasons.map((value) => ({ value, label: t(`report.reason.${value}`) }))}
        onValueChange={setReason}
      />
      <TextField
        label={t("report.note")}
        name="note"
        multiline
        value={note}
        onValueChange={(value) => setNote(value.slice(0, maxReportNote))}
        hint={t("comments.chars", { count: note.length, max: maxReportNote })}
      />
      {error === null ? null : (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}
    </Dialog>
  )
}
