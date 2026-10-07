import { createContext, useContext } from "react"
import type { Translate } from "./messages.ts"
import type { LessonModel, Target } from "./model.ts"

export interface LessonActions {
  /** Pin a target (replaces the stack) or, if it is the only pinned one, unpin it. */
  readonly pin: (t: Target) => void
  /** Add a target to the ask bar's references. */
  readonly addRef: (t: Target) => void
  /** Copy text and announce the result in the live region. */
  readonly copy: (text: string, announce?: string) => void
  /** Show a target in the inspector as a hover preview (for widgets that track hover themselves). */
  readonly preview: (t: Target | undefined) => void
}

export interface LessonContextValue {
  readonly model: LessonModel
  readonly t: Translate
  readonly actions: LessonActions
  /** Link for a `units` entry that names another lesson, if the host app provides one. */
  readonly lessonHref: ((slug: string) => string) | undefined
}

export const LessonContext = createContext<LessonContextValue | undefined>(undefined)

export const useLesson = (): LessonContextValue => {
  const v = useContext(LessonContext)
  if (v === undefined) throw new Error("useLesson must be used inside <Lesson>")
  return v
}

export type Mode = "show" | "try"

export interface ModeContextValue {
  readonly mode: Mode
  readonly revealed: ReadonlySet<string>
  readonly reveal: (keys: ReadonlyArray<string>) => void
}

export const ModeContext = createContext<ModeContextValue>({
  mode: "show",
  revealed: new Set(),
  reveal: () => {},
})

export const useMode = (): ModeContextValue => useContext(ModeContext)
