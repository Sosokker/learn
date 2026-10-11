// Comment anchors (design §6.11): the target keys of the pieces a comment can point at, plus
// `lesson` for the whole lesson. Ids are the same in every language and stay across versions, so a
// comment written on an older version usually still finds its piece; when it does not, the host
// says so instead of guessing.

import { type LessonModel, parseTargetKey, plainTitle, type Target, targetKey } from "./model.ts"
import { refName } from "./refs.ts"

export const lessonAnchor = "lesson"

/** The anchor of a target; undefined for a shared concept (comment on its card instead). */
export const anchorOf = (target: Target): string | undefined =>
  target.kind === "concept" ? undefined : targetKey(target)

const exists = (model: LessonModel, target: Target): boolean => {
  switch (target.kind) {
    case "part":
      return model.part(target.id) !== undefined
    case "card":
      return model.card(target.id) !== undefined
    case "section":
      return model.sections.has(target.section)
    case "item":
      return model.item(target.section, target.item) !== undefined
    case "concept":
      return false
  }
}

export interface AnchorInfo {
  readonly anchor: string
  /** `@slug/section.item`, `part:x`, … as in the ask bar; "" for the whole lesson. */
  readonly name: string
  /** Plain title of the piece; the lesson title for the whole lesson. */
  readonly title: string
  readonly target: Target | undefined
}

/** What an anchor points at in this version, or undefined when the piece is gone. */
export const describeAnchor = (model: LessonModel, anchor: string): AnchorInfo | undefined => {
  if (anchor === lessonAnchor) return { anchor, name: "", title: model.spec.title, target: undefined }
  const target = parseTargetKey(anchor)
  if (target === undefined || target.kind === "concept" || !exists(model, target)) return undefined
  return { anchor, name: refName(model, target), title: plainTitle(model, target, 80), target }
}
