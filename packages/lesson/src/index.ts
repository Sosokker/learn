// @app/lesson: the lesson renderer. Import the styles once in the app: `@app/lesson/styles.css`.

export { type AnchorInfo, anchorOf, describeAnchor, lessonAnchor } from "./anchors.ts"
export type { AskPayload } from "./ask.tsx"
export { highlightCss, partColorCss } from "./highlight.ts"
export { Lesson, type LessonProgress, type LessonProps } from "./lesson.tsx"
export { type LessonMessageKey, lessonMessages, makeTranslate, type Translate } from "./messages.ts"
export {
  buildModel,
  childrenOf,
  highlightFor,
  type ItemEntry,
  type LessonModel,
  parseTargetKey,
  plainTitle,
  referenceableTargets,
  type Target,
  targetKey,
} from "./model.ts"
export { buildPrompt, buildRef, copyText, refName, richToTex, targetTex } from "./refs.ts"
export { renderTex, stripTexParts } from "./tex.ts"
