import { buttonClass, CompassIcon, useT } from "@app/ui"
import { Link } from "@tanstack/react-router"
import { TopBar } from "./Shell.tsx"
import { EmptyState } from "./states.tsx"

export function NotFound() {
  const t = useT()
  return (
    <>
      <TopBar title={t("notFound.title")} />
      <EmptyState
        icon={<CompassIcon />}
        title={t("notFound.title")}
        body={t("notFound.body")}
        action={
          <Link to="/" className={buttonClass({ variant: "primary" })}>
            {t("notFound.home")}
          </Link>
        }
      />
    </>
  )
}
