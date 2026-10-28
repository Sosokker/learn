import { type ApiToken, type ApiTokenCreated, maxApiTokens } from "@app/api"
import { Button, Card, Dialog, EmptyState, Spinner, TextField, useI18n } from "@app/ui"
import {
  queryOptions,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useId, useRef, useState } from "react"
import { callApi, errorTag } from "../api.ts"
import { signInWithGoogle } from "../auth.ts"
import { formatDate } from "../format.ts"
import { PageSpinner } from "../lesson-view.tsx"
import { ProfilePanel } from "../profile-panel.tsx"
import { useViewer } from "../session.ts"

export const Route = createFileRoute("/settings")({ component: SettingsPage })

const tokensQuery = (userId: string) =>
  queryOptions({
    queryKey: ["tokens", userId] as const,
    queryFn: (context) => callApi((client) => client.tokens.list(), context.signal),
  })

function SettingsPage() {
  const { t } = useI18n()
  const viewer = useViewer()
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t("account.title")}</h1>
        <p className="text-body-sm text-ink-subtle">{t("account.description")}</p>
      </header>
      {viewer.pending ? (
        <PageSpinner />
      ) : viewer.user === null ? (
        <EmptyState
          title={t("account.signIn.title")}
          description={t("account.signIn.description")}
          action={
            <Button variant="primary" onClick={() => void signInWithGoogle().catch(() => undefined)}>
              {t("auth.signInWithGoogle")}
            </Button>
          }
        />
      ) : (
        <>
          <ProfilePanel userId={viewer.user.id} />
          <TokensPanel userId={viewer.user.id} />
        </>
      )}
    </div>
  )
}

// Refusals any token request can meet, mapped to a message.
function useErrorText() {
  const { t } = useI18n()
  return (error: unknown) => {
    const tag = errorTag(error)
    if (tag === "ApiTokenLimit") return t("tokens.limit", { max: maxApiTokens })
    if (tag === "Unauthenticated" || tag === "CrossSiteRequest" || tag === "RateLimited") {
      return t(`error.${tag}`)
    }
    return t("common.error")
  }
}

function TokensPanel(props: { readonly userId: string }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const errorText = useErrorText()
  const tokens = useQuery(tokensQuery(props.userId))
  const [name, setName] = useState("")
  const [message, setMessage] = useState<{ readonly ok: boolean; readonly text: string } | null>(null)
  const [created, setCreated] = useState<ApiTokenCreated | null>(null)
  const [revoking, setRevoking] = useState<ApiToken | null>(null)

  const create = useMutation({
    mutationFn: (tokenName: string) =>
      callApi((client) => client.tokens.create({ payload: { name: tokenName } })),
    onSuccess: (result) => {
      setCreated(result)
      setName("")
      setMessage(null)
      void queryClient.invalidateQueries({ queryKey: tokensQuery(props.userId).queryKey })
    },
    onError: (error) => setMessage({ ok: false, text: errorText(error) }),
  })

  const count = tokens.data?.length ?? 0
  const full = count >= maxApiTokens

  return (
    <Card>
      <div className="flex flex-col gap-1">
        <h2 className="text-body font-semibold text-ink">{t("tokens.title")}</h2>
        <p className="text-body-sm text-ink-subtle">{t("tokens.description", { max: maxApiTokens })}</p>
      </div>

      {created === null ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            const trimmed = name.trim()
            if (trimmed === "") return setMessage({ ok: false, text: t("tokens.nameRequired") })
            if (full) return setMessage({ ok: false, text: t("tokens.limit", { max: maxApiTokens }) })
            setMessage(null)
            create.mutate(trimmed.slice(0, 60).trim())
          }}
        >
          <TextField
            label={t("tokens.name")}
            name="token-name"
            value={name}
            onValueChange={(next) => {
              setName(next)
              setMessage(null)
            }}
            hint={t("tokens.nameHint")}
            autoComplete="off"
          />
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={create.isPending || full}>
              {create.isPending ? <Spinner size="sm" label={t("common.loading")} /> : null}
              {t("tokens.create")}
            </Button>
            {full ? (
              <span className="text-body-sm text-ink-subtle">{t("tokens.limit", { max: maxApiTokens })}</span>
            ) : null}
          </div>
        </form>
      ) : (
        <NewToken created={created} onDone={() => setCreated(null)} />
      )}

      <div aria-live="polite">
        {message === null ? null : (
          <p className={`text-body-sm ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</p>
        )}
      </div>

      <TokenList
        query={tokens}
        onRevoke={(token) => {
          setMessage(null)
          setRevoking(token)
        }}
      />

      {revoking === null ? null : (
        <RevokeDialog
          key={revoking.id}
          token={revoking}
          userId={props.userId}
          onClose={() => setRevoking(null)}
          onRevoked={(token) => {
            setRevoking(null)
            setMessage({ ok: true, text: t("tokens.revoked", { name: token.name }) })
          }}
        />
      )}
    </Card>
  )
}

// The secret, shown once. It lives only in this component's state; leaving the page drops it.
function NewToken(props: { readonly created: ApiTokenCreated; readonly onDone: () => void }) {
  const { t } = useI18n()
  const secretId = useId()
  const secretInput = useRef<HTMLInputElement>(null)
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle")

  useEffect(() => {
    secretInput.current?.focus()
    secretInput.current?.select()
  }, [])

  return (
    <div className="flex flex-col gap-3 rounded-md border border-accent/40 bg-accent/10 p-4">
      <div className="flex flex-col gap-1">
        <p className="text-body-sm font-medium text-ink">
          {t("tokens.created", { name: props.created.token.name })}
        </p>
        <p className="text-body-sm text-ink-muted">{t("tokens.copyNow")}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={secretId} className="text-dense font-medium text-ink-muted">
          {t("tokens.secretLabel")}
        </label>
        <div className="flex min-w-0 gap-2">
          <input
            ref={secretInput}
            id={secretId}
            readOnly
            value={props.created.secret}
            spellCheck={false}
            autoComplete="off"
            onFocus={(event) => event.currentTarget.select()}
            className="h-8 w-full min-w-0 rounded-md border border-hairline bg-surface-1 px-3 font-mono text-dense text-ink focus-visible:border-accent focus-visible:outline-none"
          />
          <Button
            onClick={() => {
              navigator.clipboard.writeText(props.created.secret).then(
                () => setCopy("copied"),
                () => setCopy("failed"),
              )
            }}
          >
            {copy === "copied" ? t("tokens.copied") : t("tokens.copy")}
          </Button>
        </div>
        <p className="text-caption text-ink-subtle">{t("tokens.useHint")}</p>
        <div aria-live="polite">
          {copy === "failed" ? <p className="text-caption text-danger">{t("tokens.copyFailed")}</p> : null}
        </div>
      </div>
      <div>
        <Button onClick={props.onDone}>{t("tokens.done")}</Button>
      </div>
    </div>
  )
}

function TokenList(props: {
  readonly query: UseQueryResult<ReadonlyArray<ApiToken>>
  readonly onRevoke: (token: ApiToken) => void
}) {
  const { t, locale } = useI18n()
  const { query } = props
  if (query.isPending) return <Spinner size="sm" label={t("common.loading")} />
  if (query.isError) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-body-sm text-danger">{t("tokens.loadError")}</p>
        <Button size="sm" onClick={() => void query.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    )
  }
  if (query.data.length === 0) return <p className="text-body-sm text-ink-subtle">{t("tokens.empty")}</p>
  return (
    <ul
      aria-label={t("tokens.listLabel")}
      className="flex flex-col divide-y divide-hairline border-t border-hairline"
    >
      {query.data.map((token) => (
        <li key={token.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className="truncate text-body-sm font-medium text-ink">{token.name}</span>
              <code className="font-mono text-caption text-ink-tertiary">{token.prefix}…</code>
            </span>
            <span className="text-caption text-ink-subtle">
              {t("tokens.createdOn", { date: formatDate(token.created_at, locale) })}
              {" · "}
              {token.last_used_at === null
                ? t("tokens.neverUsed")
                : t("tokens.lastUsed", { date: formatDate(token.last_used_at, locale) })}
            </span>
          </div>
          <Button
            variant="danger"
            size="sm"
            aria-label={`${t("tokens.revoke")}: ${token.name}`}
            onClick={() => props.onRevoke(token)}
          >
            {t("tokens.revoke")}
          </Button>
        </li>
      ))}
    </ul>
  )
}

function RevokeDialog(props: {
  readonly token: ApiToken
  readonly userId: string
  readonly onClose: () => void
  readonly onRevoked: (token: ApiToken) => void
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const errorText = useErrorText()
  const [error, setError] = useState<string | null>(null)
  const revoke = useMutation({
    mutationFn: () => callApi((client) => client.tokens.revoke({ params: { id: props.token.id } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tokensQuery(props.userId).queryKey })
      props.onRevoked(props.token)
    },
    onError: (failure) => {
      // Already gone (revoked in another tab): the list is stale, not the user's mistake.
      if (errorTag(failure) === "ApiTokenNotFound") {
        void queryClient.invalidateQueries({ queryKey: tokensQuery(props.userId).queryKey })
        return props.onRevoked(props.token)
      }
      setError(errorText(failure))
    },
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t("tokens.revokeTitle", { name: props.token.name })}
      description={t("tokens.revokeDescription")}
      closeLabel={t("common.close")}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" disabled={revoke.isPending} onClick={() => revoke.mutate()}>
            {revoke.isPending ? <Spinner size="sm" label={t("common.loading")} /> : null}
            {t("tokens.revoke")}
          </Button>
        </>
      }
    >
      {error === null ? null : (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
    </Dialog>
  )
}
