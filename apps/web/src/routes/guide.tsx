import { useT } from "@app/ui"
import { createFileRoute } from "@tanstack/react-router"
import { LessonReader } from "../components/LessonReader.tsx"
import { validateReaderSearch } from "../lib/search.ts"

// The guide is an ordinary public lesson, seeded as @learn/guide.
export const Route = createFileRoute("/guide")({
  validateSearch: validateReaderSearch,
  component: GuidePage,
})

function GuidePage() {
  const t = useT()
  const { lang } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <LessonReader
      handle="learn"
      slug="guide"
      lang={lang}
      pageTitle={t("guide.title")}
      onLangChange={(next) => navigate({ search: { lang: next }, replace: true })}
    />
  )
}
