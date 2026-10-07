import { createFileRoute } from "@tanstack/react-router"
import { LessonReader } from "../../components/LessonReader.tsx"
import { validateReaderSearch } from "../../lib/search.ts"

// learn.sirin.dev/@handle/slug. `@{$handle}` is a prefixed param: the segment must start with "@".
export const Route = createFileRoute("/@{$handle}/$slug")({
  validateSearch: validateReaderSearch,
  component: LessonPage,
})

function LessonPage() {
  const { handle, slug } = Route.useParams()
  const { lang } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <LessonReader
      handle={handle}
      slug={slug}
      lang={lang}
      onLangChange={(next) => navigate({ search: { lang: next }, replace: true })}
    />
  )
}
