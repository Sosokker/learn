import { handlePattern } from "@app/api"
import type { LessonLang } from "@app/domain"
import { createFileRoute } from "@tanstack/react-router"
import { LessonView } from "../lesson-view.tsx"
import { NotFound } from "../not-found.tsx"

const slugPattern = /^[a-z0-9][a-z0-9-]{0,79}$/u

// learn.sirin.dev/@handle/slug. `?lang=th` picks the lesson's language (default: the UI language).
export const Route = createFileRoute("/@{$handle}/$slug")({
  validateSearch: (search: Record<string, unknown>): { readonly lang?: LessonLang } =>
    search.lang === "en" || search.lang === "th" ? { lang: search.lang } : {},
  component: LessonPage,
})

function LessonPage() {
  const params = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  if (!handlePattern.test(params.handle) || !slugPattern.test(params.slug)) return <NotFound />
  return (
    <div className="mx-auto w-full max-w-6xl">
      <LessonView
        handle={params.handle}
        slug={params.slug}
        lang={search.lang}
        onLangChange={(lang) => void navigate({ search: { lang }, replace: true })}
      />
    </div>
  )
}
