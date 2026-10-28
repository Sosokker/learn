import { handlePattern, isReservedHandle } from "@app/api"
import { Button, Card, Spinner, TextField, useI18n } from "@app/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { callApi, errorTag } from "./api.ts"
import { meQuery, myLessonsKey } from "./queries.ts"

// The public handle (learn.sirin.dev/@handle). A new account gets a neutral one; this changes it.
// It is an account setting, so it lives on /settings, not in the Library.
export function ProfilePanel(props: { readonly userId: string }) {
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
