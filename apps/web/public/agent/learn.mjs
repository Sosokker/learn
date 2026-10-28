#!/usr/bin/env node
// The external agent's tool: validate and publish Learn lessons from files on disk. It is served
// at /agent/learn.mjs, so a harness needs no package install: download it, run it with Node 18+.
//
//   node learn.mjs init claude|opencode|codex|pi|generic
//   node learn.mjs guide [--lang en|th] > guide.json
//   node learn.mjs search "average speed" [--lang en]
//   node learn.mjs concept physics.average-speed [--lang en]
//   node learn.mjs schema
//   node learn.mjs validate <file.json | dir> [--slug my-slug]
//   node learn.mjs publish <file.json | dir> [--slug my-slug] [--dry-run]
//
// Origin: --url, LEARN_URL, then https://learn.sirin.dev. Token: --token, then LEARN_TOKEN.
// A directory holds one LessonSpec per language (en.json, th.json); validate sends them together
// so cross-language parity is checked before anything is written.

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const defaultOrigin = "https://learn.sirin.dev"
const maxLessonBytes = 512 * 1024
const slugPattern = /^[a-z0-9][a-z0-9-]{0,79}$/u
const harnesses = {
  claude: ".claude/skills/learn/SKILL.md",
  opencode: ".opencode/skills/learn/SKILL.md",
  codex: ".learn/SKILL.md",
  pi: ".learn/SKILL.md",
  generic: ".learn/SKILL.md",
}

const valueFlags = new Set(["--slug", "--url", "--token", "--lang"])
const booleanFlags = new Set(["--json", "--dry-run", "--help", "-h"])

const parseArgs = (argv) => {
  const options = { json: false, dryRun: false, help: false }
  const positional = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === undefined) continue
    if (valueFlags.has(arg)) {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith("--")) fail(`${arg} needs a value`)
      options[arg.slice(2)] = value
      index += 1
    } else if (booleanFlags.has(arg)) {
      if (arg === "--json") options.json = true
      else if (arg === "--dry-run") options.dryRun = true
      else options.help = true
    } else if (arg.startsWith("-")) {
      fail(`unknown option ${arg} (run "node learn.mjs help")`)
    } else {
      positional.push(arg)
    }
  }
  return { options, positional }
}

const originOf = (options) => {
  const raw = options.url ?? process.env.LEARN_URL ?? defaultOrigin
  let url
  try {
    url = new URL(raw)
  } catch {
    fail(`--url is not a URL: ${raw}`)
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") fail("--url must be http or https")
  if (url.username !== "" || url.password !== "") fail("--url must not contain a user or password")
  return url.origin
}

const tokenOf = (options) => {
  const token = options.token ?? process.env.LEARN_TOKEN
  if (token === undefined || token === "") {
    fail("set LEARN_TOKEN (create one at <origin>/settings) or pass --token")
  }
  if (!/^lrn_[A-Za-z0-9_-]{43}$/u.test(token)) {
    fail("the token does not look like a Learn API token (lrn_ + 43 characters)")
  }
  return token
}

const request = async (origin, path, { method = "GET", body, token } = {}) => {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body,
  })
  const text = await response.text()
  let json
  try {
    json = text === "" ? undefined : JSON.parse(text)
  } catch {
    json = undefined
  }
  return { response, text, json }
}

const readTarget = async (target) => {
  const path = resolve(target)
  const info = await stat(path).catch(() => undefined)
  if (info === undefined) fail(`no such file or directory: ${target}`)
  const paths = info.isDirectory()
    ? (await readdir(path))
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => join(path, name))
    : [path]
  if (paths.length === 0) fail(`no .json files in ${target}`)
  const files = []
  for (const file of paths) {
    const text = await readFile(file, "utf8")
    try {
      files.push({ name: basename(file), path: file, text, spec: JSON.parse(text) })
    } catch (error) {
      fail(`${basename(file)} is not JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { path, files }
}

const slugFrom = (target) => {
  const name = basename(resolve(target))
  return name.endsWith(".json") ? name.slice(0, -".json".length).replace(/\.(en|th)$/u, "") : name
}

const filesLabel = (files) => files.map((file) => file.name).join(", ")

const printIssues = (files, issues) => {
  for (const issue of issues) {
    const match = /^specs\[(\d+)\]\.?(.*)$/u.exec(issue.path)
    const where =
      match === null
        ? issue.path
        : `${files[Number(match[1])]?.name ?? `specs[${match[1]}]`}${match[2] === "" ? "" : `: ${match[2]}`}`
    console.error(`  ${where} [${issue.code}] ${issue.message}`)
  }
}

const validate = async (origin, token, slug, files, json) => {
  const payload = JSON.stringify({ specs: files.map((file) => file.spec) })
  if (Buffer.byteLength(payload, "utf8") > maxLessonBytes) {
    fail(
      `the lesson bundle is ${Buffer.byteLength(payload, "utf8")} bytes; the limit is ${maxLessonBytes}; shorten the lesson`,
    )
  }
  const result = await request(origin, `/api/me/lessons/${encodeURIComponent(slug)}/validate`, {
    method: "POST",
    body: payload,
    token,
  })
  if (result.response.status === 413) fail(`the lesson bundle is over the ${maxLessonBytes} byte limit`)
  if (result.response.status === 401) fail("the token is unknown or revoked (401)")
  if (result.response.status === 429) fail("rate limited; wait a minute and try again")
  if (result.json === undefined) fail(`HTTP ${result.response.status}: ${result.text.slice(0, 500)}`)
  if (json) console.log(JSON.stringify(result.json, null, 2))
  else if (result.json.valid) console.log(`✓ valid: ${filesLabel(files)}`)
  else {
    console.error(`✗ ${result.json.issues.length} issue${result.json.issues.length === 1 ? "" : "s"}:`)
    printIssues(files, result.json.issues)
  }
  return result.json.valid === true
}

const publish = async (origin, token, slug, files, dryRun, json) => {
  const valid = await validate(origin, token, slug, files, json && dryRun)
  if (!valid || dryRun) return valid
  const result = await request(origin, `/api/me/lessons/${encodeURIComponent(slug)}/publish`, {
    method: "POST",
    body: JSON.stringify({ specs: files.map((file) => file.spec) }),
    token,
  })
  if (result.response.status === 401) fail("the token is unknown or revoked (401)")
  if (result.response.status === 429) fail("rate limited; wait a minute and try again")
  if (result.response.status === 413) fail(`the lesson bundle is over the ${maxLessonBytes} byte limit`)
  if (result.response.status === 422 && result.json !== undefined) {
    console.error("✗ the bundle was refused by the server:")
    printIssues(files, result.json.issues ?? [])
    return false
  }
  if ((result.response.status !== 200 && result.response.status !== 201) || result.json === undefined) {
    fail(`HTTP ${result.response.status}: ${result.text.slice(0, 500)}`)
  }
  if (json) console.log(JSON.stringify(result.json, null, 2))
  const { lesson, versions } = result.json
  const url = `${origin}/@${lesson.owner_handle}/${lesson.slug}`
  for (const entry of versions) {
    const { version, created } = entry
    console.log(`${created ? "published" : "unchanged"} ${version.lang} version ${version.n} → ${url}`)
  }
  console.log(`open ${url} to preview; change visibility in Library.`)
  return true
}

const init = async (origin, harness) => {
  const target = harnesses[harness]
  if (target === undefined) {
    fail(`unknown harness "${harness}"; use claude, opencode, codex, pi or generic`)
  }
  const result = await request(origin, "/agent/SKILL.md")
  if (result.response.status !== 200) {
    fail(`could not fetch /agent/SKILL.md (HTTP ${result.response.status}); check --url`)
  }
  const path = resolve(target)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, result.text, "utf8")
  console.log(`✓ wrote ${target}`)

  if (harness === "codex" || harness === "pi") {
    const agents = resolve("AGENTS.md")
    const existing = await readFile(agents, "utf8").catch(() => "")
    const block = [
      "<!-- learn:start -->",
      "## Learn lessons",
      "Read `.learn/SKILL.md` before writing or publishing a Learn lesson.",
      "Use `node learn.mjs ...` from the project root; the token is `LEARN_TOKEN`.",
      "<!-- learn:end -->",
    ].join("\n")
    const start = existing.indexOf("<!-- learn:start -->")
    const end = existing.indexOf("<!-- learn:end -->")
    const next =
      start !== -1 && end !== -1
        ? `${existing.slice(0, start)}${block}${existing.slice(end + "<!-- learn:end -->".length)}`
        : `${existing}${existing === "" || existing.endsWith("\n") ? "" : "\n"}\n${block}\n`
    await writeFile(agents, next, "utf8")
    console.log("✓ updated AGENTS.md")
  }

  console.log("")
  console.log("Next:")
  console.log(`  export LEARN_TOKEN=lrn_…   # create one at ${origin}/settings`)
  console.log("  node learn.mjs guide > guide.en.json")
  console.log('Then ask your agent: "Write a Learn lesson about … and publish it as a private draft."')
}

const guide = async (origin, lang) => {
  const lesson = await request(origin, "/api/lessons/by/learn/guide")
  if (lesson.response.status === 404) fail("the guide lesson is not seeded on this server")
  if (lesson.json === undefined) fail(`HTTP ${lesson.response.status}: ${lesson.text.slice(0, 500)}`)
  const info = lesson.json.langs.find((entry) => entry.lang === lang) ?? lesson.json.langs[0]
  if (info === undefined) fail("the guide has no language versions")
  const body = await request(origin, `/api/lessons/${lesson.json.id}/versions/${info.version_id}/body`)
  if (body.json === undefined) fail(`HTTP ${body.response.status}: ${body.text.slice(0, 500)}`)
  console.log(JSON.stringify(body.json, null, 2))
}

const search = async (origin, query, lang, json) => {
  const params = new URLSearchParams({ q: query, limit: "8" })
  if (lang !== undefined) params.set("lang", lang)
  const result = await request(origin, `/api/concepts?${params}`)
  if (result.response.status !== 200 || result.json === undefined) {
    fail(`HTTP ${result.response.status}: ${result.text.slice(0, 500)}`)
  }
  if (json) return console.log(JSON.stringify(result.json, null, 2))
  if (result.json.length === 0) return console.log("no shared concepts found")
  for (const hit of result.json) console.log(`${hit.slug} (${hit.lang}) [${hit.kind}] ${hit.title}`)
}

const concept = async (origin, slug, lang, json) => {
  const result = await request(origin, `/api/concepts/${encodeURIComponent(slug)}`)
  if (result.response.status === 404) fail(`no concept "${slug}"`)
  if (result.response.status !== 200 || result.json === undefined) {
    fail(`HTTP ${result.response.status}: ${result.text.slice(0, 500)}`)
  }
  const info = result.json.langs.find((entry) => entry.lang === lang) ?? result.json.langs[0]
  if (info === undefined) fail(`concept "${slug}" has no language versions`)
  const body = await request(origin, `/c/${info.body_hash}.json`)
  if (body.json === undefined) fail(`HTTP ${body.response.status}: ${body.text.slice(0, 500)}`)
  console.log(JSON.stringify(json ? { ...result.json, body: body.json } : body.json, null, 2))
}

const schema = async (origin) => {
  const result = await request(origin, "/api/agent/lesson-schema")
  if (result.response.status !== 200) fail(`HTTP ${result.response.status}: ${result.text.slice(0, 500)}`)
  console.log(result.text)
}

const help = () => {
  console.log(`Learn: write, validate and publish lessons with your own agent.

Usage:
  node learn.mjs init [claude|opencode|codex|pi|generic]
  node learn.mjs guide [--lang en|th] > guide.json
  node learn.mjs search "<words>" [--lang en|th]
  node learn.mjs concept <slug> [--lang en|th]
  node learn.mjs schema
  node learn.mjs validate <file.json | dir> [--slug my-slug] [--json]
  node learn.mjs publish <file.json | dir> [--slug my-slug] [--dry-run] [--json]

Options:
  --slug <slug>    Lesson slug (default: directory or file name)
  --url <origin>   Learn origin (default: LEARN_URL or ${defaultOrigin})
  --token <token>  API token (default: LEARN_TOKEN; create one at <origin>/settings)
  --lang <lang>    Language for guide, search and concept (default: en)
  --json           Print the raw JSON answer
  --dry-run        With publish: validate only

A directory holds en.json and th.json (or any .json files). Validation sends them together, so
cross-language parity is checked before publish writes anything. Lessons start private.`)
}

const main = async () => {
  const { options, positional } = parseArgs(process.argv.slice(2))
  const [command, ...rest] = positional
  if (command === undefined || command === "help" || options.help) return help()
  const origin = originOf(options)

  switch (command) {
    case "init": {
      return init(origin, rest[0] ?? "generic")
    }
    case "guide": {
      return guide(origin, options.lang ?? "en")
    }
    case "search": {
      const query = rest.join(" ").trim()
      if (query === "") fail('search needs words, e.g. node learn.mjs search "average speed"')
      return search(origin, query, options.lang, options.json === true)
    }
    case "concept": {
      const slug = rest[0]
      if (slug === undefined) fail("concept needs a slug, e.g. node learn.mjs concept physics.average-speed")
      return concept(origin, slug, options.lang ?? "en", options.json === true)
    }
    case "schema": {
      return schema(origin)
    }
    case "validate":
    case "publish": {
      const target = rest[0]
      if (target === undefined) fail(`${command} needs a file or directory`)
      const { files } = await readTarget(target)
      const slug = options.slug ?? slugFrom(target)
      if (!slugPattern.test(slug)) {
        fail(
          `slug "${slug}" is not valid: lowercase letters, digits and dashes, 1-80 characters (use --slug)`,
        )
      }
      const token = tokenOf(options)
      if (command === "validate") {
        const valid = await validate(origin, token, slug, files, options.json === true)
        if (!valid) process.exitCode = 1
        return
      }
      const valid = await publish(origin, token, slug, files, options.dryRun === true, options.json === true)
      if (!valid) process.exitCode = 1
      return
    }
    default: {
      fail(`unknown command "${command}" (run "node learn.mjs help")`)
    }
  }
}

const fail = (message) => {
  console.error(`learn: ${message}`)
  process.exit(1)
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
}
