import "./playground.css"
import { ConceptSpec, LessonSpec, type PinnedConcept } from "@app/domain"
import { Schema } from "effect"
import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import { LessonView } from "../src/index.ts"
import { widgetsDemo } from "./demo.ts"

// The guide and every shared concept, decoded the way the app decodes API responses.
const lessons = import.meta.glob<unknown>("../../../content/guide/*.json", { eager: true, import: "default" })
const conceptFiles = import.meta.glob<unknown>("../../../content/concepts/*/*.json", {
  eager: true,
  import: "default",
})

const decodeLesson = Schema.decodeUnknownSync(LessonSpec)
const decodeConcept = Schema.decodeUnknownSync(ConceptSpec)
const specs: Record<string, LessonSpec> = Object.fromEntries(
  Object.values(lessons).map((raw) => {
    const spec = decodeLesson(raw)
    return [spec.lang, spec] as const
  }),
)
specs.demo = decodeLesson(widgetsDemo)
const concepts: Array<PinnedConcept> = Object.values(conceptFiles).map((raw) => {
  const spec = decodeConcept(raw)
  return { slug: spec.slug, version: 1, useCount: 3, spec }
})

function App() {
  const params = new URLSearchParams(location.search)
  const [lang, setLang] = useState<"en" | "th">(params.get("lang") === "th" ? "th" : "en")
  const [demo, setDemo] = useState(params.get("demo") === "1")
  const [last, setLast] = useState("")
  const spec = demo ? specs.demo : specs[lang]
  if (spec === undefined) return <p>missing content/guide/{lang}.json</p>
  return (
    <>
      <div className="pg-bar">
        <span>playground</span>
        {(["en", "th"] as const).map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={!demo && lang === l}
            onClick={() => {
              setLang(l)
              setDemo(false)
            }}
          >
            {l === "en" ? "English" : "ไทย"}
          </button>
        ))}
        <button type="button" aria-pressed={demo} onClick={() => setDemo(true)}>
          Widgets
        </button>
        <span className="pg-last" title={last}>
          {last === "" ? "" : `onAsk: ${last.split("\n")[0]}`}
        </span>
      </div>
      <LessonView
        key={demo ? "demo" : lang}
        spec={spec}
        concepts={concepts}
        slug={demo ? "widgets" : "guide"}
        uiLang={lang}
        onAsk={setLast}
        initialTryMode={params.get("try") === "1"}
      />
    </>
  )
}

const root = document.getElementById("root")
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
