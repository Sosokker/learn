import { Handle, type Me } from "@app/domain"
import {
  Button,
  CopyIcon,
  Field,
  IconButton,
  Input,
  KeyIcon,
  Panel,
  Skeleton,
  Textarea,
  TrashIcon,
  useI18n,
  useToast,
} from "@app/ui"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { type FormEvent, useState } from "react"
import { ConfirmDialog } from "../components/ConfirmDialog.tsx"
import { RequireAuth } from "../components/RequireAuth.tsx"
import { TopBar } from "../components/Shell.tsx"
import { ErrorState } from "../components/states.tsx"
import { type ApiError, call, errorMessage, toApiError } from "../lib/api.ts"
import { copyText } from "../lib/clipboard.ts"
import { meQuery, tokensQuery } from "../lib/queries.ts"

export const Route = createFileRoute("/settings")({ component: SettingsRoute })

const isHandle = Schema.is(Handle)

function SettingsRoute() {
  const { t } = useI18n()
  return (
    <RequireAuth title={t("settings.title")} reason={t("auth.requiredSettings")}>
      {(me) => (
        <>
          <TopBar title={t("settings.title")} />
          <div className="flex flex-col gap-6 px-6 py-6 max-md:px-4 max-md:py-4">
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
              <ProfilePanel me={me} />
              <TokensPanel />
            </div>
          </div>
        </>
      )}
    </RequireAuth>
  )
}

function ProfilePanel({ me }: { me: Me }) {
  const { t } = useI18n()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [handle, setHandle] = useState(me.handle)
  const [bio, setBio] = useState(me.bio ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const handleValid = isHandle(handle)
  const changed = handle !== me.handle || bio !== (me.bio ?? "")

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!handleValid || !changed) return
    setBusy(true)
    setError(null)
    const trimmedBio = bio.trim()
    try {
      const updated = await call((c) =>
        c.me.update({
          payload: {
            ...(handle !== me.handle ? { handle } : {}),
            ...(bio !== (me.bio ?? "") ? { bio: trimmedBio || null } : {}),
          },
        }),
      )
      queryClient.setQueryData(meQuery.queryKey, updated)
      // Lesson links contain the handle.
      await queryClient.invalidateQueries({ queryKey: ["library"] })
      toast(t("settings.saved"), "success")
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleError =
    error?.kind === "Conflict"
      ? t("settings.handleTaken")
      : handle && !handleValid
        ? t("settings.handleInvalid")
        : undefined

  return (
    <Panel aria-labelledby="profile-title">
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 id="profile-title" className="text-body font-semibold text-ink">
            {t("settings.profile")}
          </h2>
          <p className="text-dense text-ink-subtle">{t("settings.signedInAs", { email: me.email })}</p>
        </div>
        <Field
          label={t("settings.handle")}
          hint={t("settings.handleHint", { handle: handleValid ? handle : me.handle })}
          error={handleError}
        >
          {({ id, describedBy }) => (
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-body-sm text-ink-tertiary">
                @
              </span>
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={handleError !== undefined}
                value={handle}
                onChange={(e) => {
                  setHandle(e.target.value.toLowerCase())
                  if (error?.kind === "Conflict") setError(null)
                }}
                autoCapitalize="none"
                autoComplete="username"
                spellCheck={false}
                maxLength={30}
                className="pl-7 font-mono"
              />
            </div>
          )}
        </Field>
        <Field label={t("settings.bio")} hint={t("settings.bioHint", { n: bio.length })}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              value={bio}
              maxLength={280}
              rows={3}
              onChange={(e) => setBio(e.target.value)}
            />
          )}
        </Field>
        {error && error.kind !== "Conflict" ? (
          <p role="alert" className="text-dense text-danger">
            {errorMessage(t, error)}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={busy || !changed || !handleValid}>
            {busy ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </form>
    </Panel>
  )
}

function TokensPanel() {
  const { t, formatDate, formatRelative } = useI18n()
  const toast = useToast()
  const queryClient = useQueryClient()
  const tokens = useQuery(tokensQuery)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [created, setCreated] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null)

  const onCreate = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const token = await call((c) => c.me.createToken({ payload: { name: trimmed.slice(0, 60) } }))
      setCreated(token.token)
      setName("")
      await queryClient.invalidateQueries({ queryKey: tokensQuery.queryKey })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const copyToken = async (token: string) => {
    if (await copyText(token)) toast(t("common.copied"), "success")
  }

  return (
    <Panel aria-labelledby="tokens-title">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 id="tokens-title" className="text-body font-semibold text-ink">
            {t("settings.tokens")}
          </h2>
          <p className="text-dense text-ink-subtle">{t("settings.tokensBody")}</p>
        </div>

        <form onSubmit={onCreate} className="flex items-end gap-2 max-sm:flex-col max-sm:items-stretch">
          <Field label={t("settings.tokenName")} className="flex-1">
            {({ id }) => (
              <Input
                id={id}
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("settings.tokenNamePlaceholder")}
              />
            )}
          </Field>
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? t("settings.creating") : t("settings.createToken")}
          </Button>
        </form>
        {error ? (
          <p role="alert" className="text-dense text-danger">
            {errorMessage(t, error)}
          </p>
        ) : null}

        {created ? (
          <div
            className="flex flex-col gap-2 rounded-md border border-primary/40 bg-primary/5 p-3"
            role="status"
          >
            <p className="text-dense font-medium text-ink">{t("settings.newToken")}</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-sm border border-hairline bg-canvas px-2 py-1.5 font-mono text-dense text-ink select-all">
                {created}
              </code>
              <Button size="sm" onClick={() => copyToken(created)}>
                <CopyIcon className="size-3.5" />
                {t("common.copy")}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-md border border-hairline">
          {tokens.isPending ? (
            <div className="flex flex-col" role="status" aria-label={t("common.loading")}>
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="flex h-12 items-center gap-3 border-b border-hairline px-3 last:border-b-0"
                >
                  <Skeleton className="size-4" />
                  <Skeleton className="h-3 w-32" />
                </div>
              ))}
            </div>
          ) : tokens.isError ? (
            <ErrorState error={tokens.error} onRetry={() => tokens.refetch()} />
          ) : tokens.data.length === 0 ? (
            <p className="px-3 py-4 text-center text-dense text-ink-subtle">{t("settings.noTokens")}</p>
          ) : (
            <ul>
              {tokens.data.map((token) => (
                <li
                  key={token.id}
                  className="flex min-h-12 items-center gap-3 border-b border-hairline px-3 py-2 last:border-b-0"
                >
                  <KeyIcon className="shrink-0 text-ink-subtle" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-dense font-medium text-ink">{token.name}</span>
                    <span className="text-caption text-ink-subtle">
                      {t("settings.created", { date: formatDate(token.createdAt) })} ·{" "}
                      {token.lastUsedAt === null
                        ? t("settings.neverUsed")
                        : t("settings.lastUsed", { date: formatRelative(token.lastUsedAt) })}
                    </span>
                  </div>
                  <IconButton
                    label={`${t("settings.revoke")}: ${token.name}`}
                    size="sm"
                    onClick={() => setRevokeTarget({ id: token.id, name: token.name })}
                  >
                    <TrashIcon />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title={t("settings.revokeTitle", { name: revokeTarget?.name ?? "" })}
        body={t("settings.revokeBody")}
        confirmLabel={t("settings.revoke")}
        onConfirm={async () => {
          if (!revokeTarget) return
          await call((c) => c.me.revokeToken({ params: { id: revokeTarget.id } }))
          await queryClient.invalidateQueries({ queryKey: tokensQuery.queryKey })
          toast(t("settings.revoked"))
        }}
      />
    </Panel>
  )
}
