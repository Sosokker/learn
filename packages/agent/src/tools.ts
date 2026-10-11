import type { GenerationTool, Issue } from "@app/api"
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core"
import { type Static, type TSchema, Type } from "typebox"

// The fixed tool set (ADR 0009). Names, descriptions and parameter schemas are the same bytes for
// every user and every job: they come first in the cached prompt prefix, so any change here is a
// cache miss for everyone until it is warm again. None of them takes a user, lesson or owner id:
// the job's user comes from the job row, and unknown arguments are refused.

const searchParameters = Type.Object(
  {
    q: Type.String({
      minLength: 1,
      maxLength: 100,
      description: "Words to search for, e.g. 'average speed' or 'อัตราเร็วเฉลี่ย'.",
    }),
  },
  { additionalProperties: false },
)

const conceptParameters = Type.Object(
  {
    slug: Type.String({
      minLength: 3,
      maxLength: 200,
      description: "A slug returned by search_concepts, e.g. 'physics.average-speed'.",
    }),
  },
  { additionalProperties: false },
)

const specDescription = "The whole LessonSpec as a JSON object (not a string)."

const validateParameters = Type.Object(
  { spec: Type.Unknown({ description: specDescription }) },
  { additionalProperties: false },
)

const saveParameters = Type.Object(
  {
    spec: Type.Optional(
      Type.Unknown({
        description: `${specDescription} Omit it to save the spec validate_lesson last accepted.`,
      }),
    ),
  },
  { additionalProperties: false },
)

// What a tool step shows in the job's progress (GenerationEvent "tool").
export interface StepDetails {
  readonly label: string | null
  readonly ok: boolean
  readonly issues: ReadonlyArray<Issue>
  readonly issue_count: number
}

export type ToolResult = AgentToolResult<StepDetails>

export interface ToolHandlers {
  readonly searchConcepts: (args: Static<typeof searchParameters>) => Promise<ToolResult>
  readonly getConcept: (args: Static<typeof conceptParameters>) => Promise<ToolResult>
  readonly validateLesson: (args: Static<typeof validateParameters>) => Promise<ToolResult>
  readonly saveDraft: (args: Static<typeof saveParameters>) => Promise<ToolResult>
}

const tool = <P extends TSchema>(
  name: GenerationTool,
  label: string,
  description: string,
  parameters: P,
  execute: (args: Static<P>) => Promise<ToolResult>,
): AgentTool<P, StepDetails> => ({
  name,
  label,
  description,
  parameters,
  // One at a time: save_draft relies on the validate before it.
  executionMode: "sequential",
  execute: (_id, args) => execute(args),
})

export const makeTools = (handlers: ToolHandlers): ReadonlyArray<AgentTool<TSchema, StepDetails>> => [
  tool(
    "search_concepts",
    "Search concepts",
    'Full-text search over the site\'s shared concepts (reusable cards: laws, definitions, formulas). Returns up to 8 slugs with titles. Reuse a fitting concept with a card entry { "concept": "<slug>" } instead of writing that card yourself.',
    searchParameters,
    handlers.searchConcepts,
  ),
  tool(
    "get_concept",
    "Read a concept",
    "One shared concept: its title, kind, aliases, prerequisites and the start of its card, in the lesson's language when it has one.",
    conceptParameters,
    handlers.getConcept,
  ),
  tool(
    "validate_lesson",
    "Validate the lesson",
    "Checks a LessonSpec against the schema and the format rules (ids, links, expressions, ranges) and this job's language. Returns 'valid' or a list of issues as path [code] message. Saves nothing.",
    validateParameters,
    handlers.validateLesson,
  ),
  tool(
    "save_draft",
    "Save the draft",
    "Saves the lesson as the user's private draft; saving again replaces it with a new version. Call it once validate_lesson says valid, then stop.",
    saveParameters,
    handlers.saveDraft,
  ),
]

export const toolNames: ReadonlyArray<GenerationTool> = [
  "search_concepts",
  "get_concept",
  "validate_lesson",
  "save_draft",
]
