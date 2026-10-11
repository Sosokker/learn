import { type ApiToken, type ApiTokenCreated, type ByokKey, type ByokProvider, maxApiTokens } from "@app/api"
import { Button, Card, Dialog, EmptyState, Input, Select, Spinner, TextField, useI18n } from "@app/ui"
import {
  queryOptions,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect, useId, useRef, useState } from "react"
import { callApi, errorTag } from "../api.ts"
import { signInWithGoogle } from "../auth.ts"
import { formatDate } from "../format.ts"
import { generationOptionsKey, generationOptionsQuery } from "../generation.tsx"
import { PageSpinner } from "../lesson-view.tsx"
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
          <TokensPanel userId={viewer.user.id} />
          <KeysPanel userId={viewer.user.id} />
          <p className="text-body-sm text-ink-subtle">
            <Link to="/library" className="text-ink-muted underline underline-offset-2 hover:text-ink">
              {t("account.profileHint")}
            </Link>
          </p>
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

const keysQuery = (userId: string) =>
  queryOptions({
    queryKey: ["byok-keys", userId] as const,
    queryFn: (context) => callApi((client) => client.keys.list(), context.signal),
  })

const keyProviders: ReadonlyArray<ByokProvider> = ["anthropic", "openai", "deepseek"]

// The user's own provider keys for AI lessons (BYOK). The key is sent once and never comes back:
// the list shows the provider and the last 4 characters only.
function KeysPanel(props: { readonly userId: string }) {
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()
  const keys = useQuery(keysQuery(props.userId))
  const [provider, setProvider] = useState<ByokProvider>("anthropic")
  // Which models each key serves, and whether a free quota exists at all (not at launch).
  const options = useQuery(generationOptionsQuery(props.userId))
  const models = options.data?.models ?? []
  const quota = models.some((model) => model.platform)
  const usedBy = models.filter((model) => model.provider === provider).map((model) => model.label)
  const [key, setKey] = useState("")
  const [message, setMessage] = useState<{ readonly ok: boolean; readonly text: string } | null>(null)
  const keyId = useId()
  const providerName = (value: ByokProvider) => t(`provider.${value}`)
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keysQuery(props.userId).queryKey })
    void queryClient.invalidateQueries({ queryKey: generationOptionsKey })
  }
  const errorText = (error: unknown, value: ByokProvider) => {
    const tag = errorTag(error)
    if (tag === "InvalidByokKey") return t("keys.error.InvalidByokKey", { provider: providerName(value) })
    if (tag === "ByokUnavailable") return t("keys.unavailable")
    if (tag === "Unauthenticated" || tag === "CrossSiteRequest" || tag === "RateLimited")
      return t(`error.${tag}`)
    return t("common.error")
  }

  const save = useMutation({
    mutationFn: (input: { readonly provider: ByokProvider; readonly key: string }) =>
      callApi((client) =>
        client.keys.set({ params: { provider: input.provider }, payload: { key: input.key } }),
      ),
    onSuccess: (stored) => {
      setKey("")
      setMessage({ ok: true, text: t("keys.saved", { provider: providerName(stored.provider) }) })
      refresh()
    },
    onError: (error, input) => setMessage({ ok: false, text: errorText(error, input.provider) }),
  })
  const remove = useMutation({
    mutationFn: (value: ByokProvider) =>
      callApi((client) => client.keys.remove({ params: { provider: value } })),
    onSuccess: (_, value) => {
      setMessage({ ok: true, text: t("keys.removed", { provider: providerName(value) }) })
      refresh()
    },
    onError: (error, value) => {
      if (errorTag(error) === "ByokKeyNotFound") return refresh()
      setMessage({ ok: false, text: errorText(error, value) })
    },
  })

  return (
    <Card id="ai-keys" className="scroll-mt-20">
      <div className="flex flex-col gap-1">
        <h2 className="text-body font-semibold text-ink">{t("keys.title")}</h2>
        <p className="text-body-sm text-ink-subtle">
          {t(quota ? "keys.description.quota" : "keys.description")}
        </p>
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          const trimmed = key.trim()
          if (trimmed === "") return setMessage({ ok: false, text: t("keys.keyRequired") })
          setMessage(null)
          save.mutate({ provider, key: trimmed })
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <Select
            label={t("keys.provider")}
            value={provider}
            onValueChange={(next) => {
              setProvider(next)
              setMessage(null)
            }}
            options={keyProviders.map((value) => ({ value, label: providerName(value) }))}
          />
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={keyId} className="text-dense font-medium text-ink-muted">
              {t("keys.key")}
            </label>
            <Input
              id={keyId}
              type="password"
              name="api-key"
              value={key}
              autoComplete="off"
              spellCheck={false}
              onValueChange={(next) => {
                setKey(next)
                setMessage(null)
              }}
              className="font-mono"
            />
          </div>
        </div>
        <p className="text-caption text-ink-subtle">
          {options.isSuccess ? (
            <>
              {usedBy.length > 0
                ? t("keys.usedBy", { models: usedBy.join(", ") })
                : t("keys.usedByNone", { provider: providerName(provider) })}{" "}
            </>
          ) : null}
          {t("keys.keyHint")} {t("keys.replaceHint")}
        </p>
        <div>
          <Button type="submit" variant="secondary" disabled={save.isPending}>
            {save.isPending ? <Spinner size="sm" label={t("common.loading")} /> : null}
            {t("keys.save")}
          </Button>
        </div>
      </form>
      <div aria-live="polite">
        {message === null ? null : (
          <p className={`text-body-sm ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</p>
        )}
      </div>
      {keys.isPending ? (
        <Spinner size="sm" label={t("common.loading")} />
      ) : keys.isError ? (
        <div className="flex items-center gap-3">
          <p className="text-body-sm text-danger">{t("keys.loadError")}</p>
          <Button size="sm" onClick={() => void keys.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : keys.data.length === 0 ? (
        <p className="text-body-sm text-ink-subtle">{t("keys.empty")}</p>
      ) : (
        <ul
          aria-label={t("keys.listLabel")}
          className="flex flex-col divide-y divide-hairline border-t border-hairline"
        >
          {keys.data.map((stored: ByokKey) => (
            <li key={stored.provider} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span className="text-body-sm font-medium text-ink">{providerName(stored.provider)}</span>
                  <code className="font-mono text-caption text-ink-tertiary">
                    {t("keys.ending", { last4: stored.last4 })}
                  </code>
                </span>
                <span className="text-caption text-ink-subtle">
                  {t("keys.added", { date: formatDate(stored.created_at, locale) })}
                </span>
              </div>
              <Button
                variant="danger"
                size="sm"
                disabled={remove.isPending}
                aria-label={`${t("keys.remove")}: ${providerName(stored.provider)}`}
                onClick={() => {
                  setMessage(null)
                  remove.mutate(stored.provider)
                }}
              >
                {t("keys.remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
