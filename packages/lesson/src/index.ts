// Public surface of the lesson renderer.
export { cardChildren, type Resolved, resolveTarget, type Target } from "./cards.ts"
export { LessonView, type LessonViewProps, partStyles } from "./LessonView.tsx"
export { formatNumber, niceTicks, type Pt, sampleCurve, segmentsToPath } from "./plot-math.ts"
export { type AskPromptInput, buildAskPrompt, refChip, richToPrompt } from "./refs.ts"
export { katexHtml, Rich, Tex } from "./rich.tsx"
export { type Strings, strings } from "./strings.ts"
