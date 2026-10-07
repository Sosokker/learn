import type { LessonSpec, PinnedConcept } from "@app/domain"
import { createContext, useContext } from "react"
import type { Target } from "./cards.ts"
import type { Store } from "./store.ts"
import type { Strings } from "./strings.ts"

export interface InspectorState {
  // The drill-down path of pinned cards; the last one is shown.
  readonly path: ReadonlyArray<Target>
  // A card being hovered in the lesson, shown instead of the pinned one until the pointer leaves.
  readonly preview: Target | null
}

export interface LessonCtx {
  readonly spec: LessonSpec
  readonly concepts: ReadonlyArray<PinnedConcept>
  readonly slug: string
  readonly s: Strings
  readonly uiLang: "en" | "th"
  readonly inspector: Store<InspectorState>
  readonly tryMode: Store<boolean>
  readonly reveals: Store<ReadonlySet<string>>
  readonly refs: Store<ReadonlyArray<string>>
  readonly addRef: (key: string) => void
}

export const LessonContext = createContext<LessonCtx | null>(null)

export function useLesson(): LessonCtx {
  const ctx = useContext(LessonContext)
  if (ctx === null) throw new Error("useLesson outside <LessonView>")
  return ctx
}

// What a card or part link does depends on where it is: in the lesson it previews and pins, inside
// a pinned card it drills one level down.
export interface LinkScope {
  readonly open: (t: Target) => void
  readonly preview: (t: Target | null) => void
}

const noop = () => {}
export const LinkScopeContext = createContext<LinkScope>({ open: noop, preview: noop })
