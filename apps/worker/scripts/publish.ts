// Publishes a lesson from disk with an API token (ADR 0008), the way pi does:
//
//   LEARN_TOKEN=lrn_… bun scripts/publish.ts <file.json | dir> [--slug <slug>] [--url <origin>] [--dry-run]
//
// A file is one LessonSpec (one language). A directory holds one file per language (en.json,
// th.json); they are checked against each other for en/th parity and published in that order.
// Everything is validated locally with @app/domain first, so most mistakes never reach the
// server; the server still validates (concept references, parity with what is already
// published). `--dry-run` validates only. The slug defaults to the directory name, or the file
// name without `.json` and a trailing `.en` / `.th` (`<dir>/en.json` takes the folder's name).
// New lessons start private.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { apiTokenPattern, Issue, LessonSlug, Published, PublishUnchanged } from "@app/api"
import { checkLesson, compareTranslations, type LessonSpec } from "@app/domain"
import { Option, Schema } from "effect"
import { publishOrigin } from "./publish-origin.ts"

// Error bodies worth reading: InvalidLesson (422) and RateLimited (429).
const InvalidBody = Schema.Struct({ issues: Schema.Array(Issue) })
const LimitedBody = Schema.Struct({ retry_after_seconds: Schema.Int })

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

type Body = { readonly file: string; readonly bytes: Uint8Array; readonly spec: LessonSpec }

const files = statSync(path).isDirectory()
  ? readdirSync(path)
      .filter((name) => name.endsWith(".json"))
      .sort(byLanguage)
      .map((name) => join(path, name))
  : [path]
if (files.length === 0) fail(`no .json files in ${path}`)

const slug = option("--slug") ?? slugFrom(path)
if (!Schema.is(LessonSlug)(slug)) {
  fail(`slug "${slug}" is not valid: lowercase letters, digits and dashes, 1-80 characters (use --slug)`)
}

// Local checks: schema + validator for each file, then parity between languages.
let problems = 0
const bodies: Array<Body> = []
for (const file of files) {
  const bytes = new Uint8Array(readFileSync(file))
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    report(file, [{ path: "$", code: "json", message: String(error) }])
    continue
  }
  const checked = checkLesson(json)
  report(file, checked.issues)
  if (checked.spec !== undefined && checked.issues.length === 0)
    bodies.push({ file, bytes, spec: checked.spec })
}
const langs = bodies.map((body) => body.spec.lang)
const duplicate = langs.find((lang, index) => langs.indexOf(lang) !== index)
if (duplicate !== undefined)
  report(path, [{ path: "lang", code: "duplicate", message: `two files are ${duplicate}` }])
const [base, ...others] = bodies
if (base !== undefined) {
  for (const other of others)
    report(`${basename(base.file)} vs ${basename(other.file)}`, compareTranslations(base.spec, other.spec))
}
if (problems > 0) fail(`not published: ${problems} problem${problems === 1 ? "" : "s"}`)
console.log(
  `ok: ${bodies.map((body) => `${basename(body.file)} (${body.spec.lang})`).join(", ")} → slug "${slug}"`,
)
if (dryRun) process.exit(0)

const token = process.env.LEARN_TOKEN
if (token === undefined || token === "") fail("set LEARN_TOKEN (create a token at <url>/settings)")
if (!apiTokenPattern.test(token)) fail("LEARN_TOKEN does not look like an API token (lrn_ + 43 characters)")

for (const body of bodies) {
  const response = await fetch(`${origin}/api/me/lessons/${slug}/versions`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body.bytes,
  })
  const text = await response.text()
  // 201: a new version. 200: the body is the language's current version already; nothing changed.
  if (response.status === 201 || response.status === 200) {
    const published = Schema.decodeUnknownSync(Schema.Union([Published, PublishUnchanged]))(JSON.parse(text))
    const { lesson, version } = published
    console.log(
      `${published.created ? "published" : "unchanged"} ${basename(body.file)}: version ${version.n} (${version.lang}), ${lesson.visibility} → ${origin}/@${lesson.owner_handle}/${lesson.slug}`,
    )
    continue
  }
  const issues = decodeJson(text, InvalidBody)
  if (issues !== undefined) {
    report(`${basename(body.file)} (server)`, issues.issues)
  } else if (response.status === 401) {
    console.error("refused: the token is unknown or revoked (401)")
  } else if (response.status === 429) {
    const limited = decodeJson(text, LimitedBody)
    console.error(`rate limited: try again in ${limited?.retry_after_seconds ?? 60} s`)
  } else {
    console.error(`HTTP ${response.status}: ${text.slice(0, 500)}`)
  }
  fail(`stopped at ${basename(body.file)}`)
}

function report(
  label: string,
  issues: ReadonlyArray<{ readonly path: string; readonly code: string; readonly message: string }>,
) {
  if (issues.length === 0) return
  problems += issues.length
  console.error(`${label}:`)
  for (const issue of issues) console.error(`  ${issue.path}  [${issue.code}]  ${issue.message}`)
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

// en first: the default language goes up before its translations.
function byLanguage(a: string, b: string) {
  const rank = (name: string) => (name === "en.json" ? 0 : 1)
  return rank(a) - rank(b) || a.localeCompare(b)
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
