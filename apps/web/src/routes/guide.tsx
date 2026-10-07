import { createFileRoute } from "@tanstack/react-router"
import { LessonView } from "../lesson-view.tsx"
import { guideRef } from "../queries.ts"

// The platform guide in the current UI language (the lesson falls back to its default language
// when it has no version in the UI language). The language switch in the sidebar changes it.
export const Route = createFileRoute("/guide")({
  component: () => (
    <div className="mx-auto w-full max-w-6xl">
      <LessonView handle={guideRef.handle} slug={guideRef.slug} />
    </div>
  ),
})
