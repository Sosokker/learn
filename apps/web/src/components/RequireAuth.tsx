import type { Me } from "@app/domain"
import { Button, GoogleIcon, LockIcon, Skeleton, useI18n, useToast } from "@app/ui"
import { useQuery } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { signInWithGoogle } from "../lib/auth.ts"
import { meQuery } from "../lib/queries.ts"
import { TopBar } from "./Shell.tsx"
import { EmptyState, ErrorState } from "./states.tsx"

// Pages for signed-in users. Anonymous visitors get a sign-in prompt in place of the page, so the
// URL stays and they come back to it after Google.
export function RequireAuth({
  title,
  reason,
  children,
}: {
  title: string
  reason: string
  children: (me: Me) => ReactNode
}) {
  const { t } = useI18n()
  const me = useQuery(meQuery)
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  if (me.isPending) {
    return (
      <>
        <TopBar title={title} />
        <div className="flex flex-col gap-3 px-6 py-6" role="status" aria-label={t("common.loading")}>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-24 w-full max-w-2xl rounded-lg" />
        </div>
      </>
    )
  }
  if (me.isError) {
    return (
      <>
        <TopBar title={title} />
        <ErrorState error={me.error} onRetry={() => me.refetch()} />
      </>
    )
  }
  if (!me.data) {
    const onSignIn = async () => {
      setBusy(true)
      const ok = await signInWithGoogle().catch(() => false)
      if (!ok) {
        setBusy(false)
        toast(t("auth.signInFailed"), "danger")
      }
    }
    return (
      <>
        <TopBar title={title} />
        <EmptyState
          icon={<LockIcon />}
          title={t("auth.requiredTitle")}
          body={reason}
          action={
            <Button variant="primary" onClick={onSignIn} disabled={busy}>
              <GoogleIcon className="size-3.5" />
              {t("auth.signIn")}
            </Button>
          }
        />
      </>
    )
  }
  return <>{children(me.data)}</>
}
