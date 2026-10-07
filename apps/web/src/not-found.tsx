import { buttonClass, EmptyState, useI18n } from "@app/ui"
import { Link } from "@tanstack/react-router"

export function NotFound() {
  const { t } = useI18n()
  return (
    <div className="mx-auto w-full max-w-xl py-10">
      <EmptyState
        title={t("notFound.title")}
        description={t("notFound.description")}
        action={
          <Link to="/library" className={buttonClass("secondary", "sm")}>
            {t("notFound.back")}
          </Link>
        }
      />
    </div>
  )
}
