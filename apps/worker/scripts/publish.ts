// Publishes a lesson from disk with an API token (ADR 0008), the way pi does:
//
//   LEARN_TOKEN=lrn_… bun scripts/publish.ts <file.json | dir> [--slug <slug>] [--url <origin>] [--dry-run]
//
// A file is one LessonSpec (one language). A directory holds one file per language (en.json,
// th.json). The server checks the whole set together (schema, concepts, links, kind, en/th parity)
// and writes every new version in one batch; `--dry-run` asks for that same check without a write.
// The slug defaults to the directory name, or the file name without `.json` and a trailing `.en` /
// `.th` (`<dir>/en.json` takes the folder's name). New lessons start private.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import {
  apiTokenPattern,
  Issue,
  LessonSlug,
  LessonValidation,
  PublishedLesson,
  PublishLessonUnchanged,
} from "@app/api"
import { Option, Schema } from "effect"
import { publishOrigin } from "./publish-origin.ts"

// Error bodies worth reading: InvalidLesson (422) and RateLimited (429).
const InvalidBody = Schema.Struct({ issues: Schema.Array(Issue) })
const LimitedBody = Schema.Struct({ retry_after_seconds: Schema.Int })
const PublishedBody = Schema.Union([PublishedLesson, PublishLessonUnchanged])

const usage =
  "usage: LEARN_TOKEN=lrn_… bun scripts/publish.ts <file.json | dir> [--slug <slug>] [--url <origin>] [--dry-run]"

const args = process.argv.slice(2)
const option = (name: string) => {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}
const optionNames = new Set(["--slug", "--url"])
const positional = args.filter(
  (arg, index) => !arg.startsWith("--") && !optionNames.has(args[index - 1] ?? ""),
)
const target = positional[0]
if (target === undefined || positional.length > 1 || args.includes("--help")) fail(usage)

const dryRun = args.includes("--dry-run")
const server = publishOrigin(option("--url") ?? process.env.LEARN_URL ?? "https://learn.sirin.dev")
if (!server.ok) fail(server.reason)
const origin = server.origin
const path = resolve(target)

type Body = { readonly file: string; readonly json: unknown }

const files = statSync(path).isDirectory()
  ? readdirSync(path)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => join(path, name))
  : [path]
if (files.length === 0) fail(`no .json files in ${path}`)

const slug = option("--slug") ?? slugFrom(path)
if (!Schema.is(LessonSlug)(slug)) {
  fail(`slug "${slug}" is not valid: lowercase letters, digits and dashes, 1-80 characters (use --slug)`)
}

// Local JSON check only: the server owns the schema, references and parity for the whole set.
let problems = 0
const bodies: Array<Body> = []
for (const file of files) {
  try {
    bodies.push({ file, json: JSON.parse(new TextDecoder().decode(readFileSync(file))) })
  } catch (error) {
    report(file, [{ path: "$", code: "json", message: String(error) }])
  }
}
if (problems > 0) fail(`not published: ${problems} problem${problems === 1 ? "" : "s"}`)
console.log(`lesson: ${bodies.map((body) => basename(body.file)).join(", ")} → slug "${slug}"`)

const token = process.env.LEARN_TOKEN
if (token === undefined || token === "") fail("set LEARN_TOKEN (create a token at <url>/settings)")
if (!apiTokenPattern.test(token)) fail("LEARN_TOKEN does not look like an API token (lrn_ + 43 characters)")

const endpoint = dryRun ? "validate" : "publish"
const response = await fetch(`${origin}/api/me/lessons/${slug}/${endpoint}`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ specs: bodies.map((body) => body.json) }),
})
const text = await response.text()

if (response.status === 401) fail("refused: the token is unknown or revoked (401)")
if (response.status === 429) {
  const limited = decodeJson(text, LimitedBody)
  fail(`rate limited: try again in ${limited?.retry_after_seconds ?? 60} s`)
}
if (response.status === 413) fail("the lesson bundle is over the 512 KB limit")

if (dryRun) {
  if (response.status !== 200) fail(`HTTP ${response.status}: ${text.slice(0, 500)}`)
  const validation = decodeJson(text, LessonValidation)
  if (validation === undefined) fail(`HTTP 200 with an unreadable answer: ${text.slice(0, 500)}`)
  if (!validation.valid) {
    report(`lesson "${slug}"`, validation.issues)
    fail(`invalid: ${problems} problem${problems === 1 ? "" : "s"}`)
  }
  console.log("valid")
  process.exit(0)
}

if (response.status === 422) {
  const issues = decodeJson(text, InvalidBody)
  if (issues !== undefined) report(`lesson "${slug}"`, issues.issues)
  else console.error(`HTTP 422: ${text.slice(0, 500)}`)
  fail(`not published: ${problems} problem${problems === 1 ? "" : "s"}`)
}
if (response.status !== 200 && response.status !== 201) fail(`HTTP ${response.status}: ${text.slice(0, 500)}`)

const published = decodeJson(text, PublishedBody)
if (published === undefined) fail(`HTTP ${response.status} with an unreadable answer: ${text.slice(0, 500)}`)
const url = `${origin}/@${published.lesson.owner_handle}/${published.lesson.slug}`
// 201: at least one new version; 200: every language was already current.
for (const entry of published.versions) {
  console.log(
    `${entry.created ? "published" : "unchanged"} ${entry.version.lang} version ${entry.version.n} → ${url}`,
  )
}
console.log(`open ${url} to preview; change visibility in Library.`)

function report(
  label: string,
  issues: ReadonlyArray<{ readonly path: string; readonly code: string; readonly message: string }>,
) {
  if (issues.length === 0) return
  problems += issues.length
  console.error(`${label}:`)
  for (const issue of issues) console.error(`  ${fileLabel(issue.path)}  [${issue.code}]  ${issue.message}`)
}

// A server issue path is `specs[i].<field>`; show the file it belongs to, as learn.mjs does.
function fileLabel(path: string) {
  const match = /^specs\[(\d+)\]\.?(.*)$/u.exec(path)
  if (match === null) return path
  const index = Number(match[1])
  const name = bodies[index]?.file
  const rest = match[2] ?? ""
  return `${name === undefined ? `specs[${index}]` : basename(name)}${rest === "" ? "" : `: ${rest}`}`
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function slugFrom(file: string) {
  const name = basename(file)
    .replace(/\.json$/iu, "")
    .replace(/\.(en|th)$/iu, "")
  // `lesson/en.json` is the lesson in the folder `lesson`.
  const stem = /^(en|th)$/iu.test(name) ? basename(dirname(file)) : name
  return stem
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80)
}

function decodeJson<A>(text: string, schema: Schema.Decoder<A>): A | undefined {
  try {
    return Option.getOrUndefined(Schema.decodeUnknownOption(schema)(JSON.parse(text)))
  } catch {
    return undefined
  }
}
