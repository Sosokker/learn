// Decoding and the JSON Schema export. Decoding is strict: an unknown key is an error, not
// silently dropped, so a typo such as `whynot` fails loudly instead of losing the field.

import { Result, Schema } from "effect"
import { ConceptSpec, LessonSpec } from "./lesson.ts"
import { type Issue, type ValidateOptions, validateConcept, validateLesson } from "./validate.ts"

const strict = { onExcessProperty: "error" } as const

/** Decode unknown JSON into a LessonSpec (schema only; run `validateLesson` after). */
export const decodeLesson = Schema.decodeUnknownResult(LessonSpec, strict)

/** Decode unknown JSON into a ConceptSpec (schema only; run `validateConcept` after). */
export const decodeConcept = Schema.decodeUnknownResult(ConceptSpec, strict)

export interface Checked<A> {
  /** The decoded spec, when the schema accepted it (it may still have issues). */
  readonly spec: A | undefined
  /** Schema errors (code `schema`, path `$`) or validator issues. Empty = publishable. */
  readonly issues: ReadonlyArray<Issue | SchemaIssue>
}

export interface SchemaIssue {
  readonly path: "$"
  readonly code: "schema"
  readonly message: string
}

/** Decode + validate in one call: what the server and pi run before publishing a lesson. */
export const checkLesson = (input: unknown, options: ValidateOptions = {}): Checked<LessonSpec> => {
  const decoded = decodeLesson(input)
  if (Result.isFailure(decoded)) {
    return { spec: undefined, issues: [{ path: "$", code: "schema", message: decoded.failure.message }] }
  }
  return { spec: decoded.success, issues: validateLesson(decoded.success, options) }
}

/** Decode + validate one concept on its own (the graph check needs the whole set). */
export const checkConcept = (input: unknown): Checked<ConceptSpec> => {
  const decoded = decodeConcept(input)
  if (Result.isFailure(decoded)) {
    return { spec: undefined, issues: [{ path: "$", code: "schema", message: decoded.failure.message }] }
  }
  return { spec: decoded.success, issues: validateConcept(decoded.success) }
}

/**
 * JSON Schema (draft 2020-12) of LessonSpec, for pi's `learn` skill. Best effort: it covers
 * shapes, enums, id patterns and length caps; references and expressions are checked only by
 * `validateLesson`. Unknown keys are rejected, matching `decodeLesson`.
 */
export const lessonJsonSchema = () => Schema.toJsonSchemaDocument(LessonSpec, strict)

/** JSON Schema (draft 2020-12) of ConceptSpec. */
export const conceptJsonSchema = () => Schema.toJsonSchemaDocument(ConceptSpec, strict)
