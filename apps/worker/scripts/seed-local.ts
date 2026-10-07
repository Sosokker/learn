// Seeds the local dev database (the one `bun run dev` uses) with the platform content:
// the shared concepts and the "Start here" guide, as a public lesson owned by @learn.
// Safe to run again: unchanged bodies are skipped.
//
//   bun run db:migrate:local && bun run seed:local
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { newApiToken, sha256Hex, uuidv7 } from "@app/db"
import { ConceptSpec, LessonSpec } from "@app/domain"
import { Schema } from "effect"
import { getPlatformProxy } from "wrangler"
import type { Env } from "../src/env.ts"
import worker from "../src/worker.ts"

const root = join(import.meta.dirname, "../../..")
const read = (p: string): unknown => JSON.parse(readFileSync(join(root, p), "utf8"))

const proxy = await getPlatformProxy<Env>({
  configPath: join(root, "apps/worker/wrangler.jsonc"),
  persist: { path: join(root, "apps/worker/.wrangler/state/v3") },
})
const { WRITE_LIMIT: _limit, ...bindings } = proxy.env
const env: Env = {
  ...bindings,
  PUBLIC_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "seed-only-secret-seed-only-secret-0123",
  GOOGLE_CLIENT_ID: "seed",
  GOOGLE_CLIENT_SECRET: "seed",
}

const tables = await env.DB.prepare(
  "select name from sqlite_master where type = 'table' and name = 'lesson'",
).all()
if (tables.results.length === 0) {
  console.error("The local database has no tables. Run `bun run db:migrate:local` first.")
  process.exit(1)
}

// The platform user. It never signs in; the seed acts as it through a throwaway API token.
const handle = "learn"
const now = Date.now()
let userId = (
  await env.DB.prepare("select user_id from profile where handle = ?")
    .bind(handle)
    .first<{ user_id: string }>()
)?.user_id
if (userId === undefined) {
  userId = uuidv7()
  await env.DB.batch([
    env.DB.prepare(
      "insert into user (id, name, email, email_verified, created_at, updated_at) values (?, 'Learn', 'learn@learn.sirin.dev', 1, ?, ?)",
    ).bind(userId, now, now),
    env.DB.prepare(
      "insert into profile (user_id, handle, bio) values (?, ?, 'Guides and shared concepts.')",
    ).bind(userId, handle),
  ])
}
const token = newApiToken()
const tokenId = uuidv7()
await env.DB.prepare(
  "insert into api_token (id, user_id, hash, name, created_at) values (?, ?, ?, 'seed', ?)",
)
  .bind(tokenId, userId, await sha256Hex(token), now)
  .run()

const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as never
async function api(method: string, path: string, body?: unknown) {
  const res = await worker.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
    ctx,
  )
  const json = res.status === 204 ? null : await res.json()
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json, null, 2)}`)
  return json as never
}
// The server hashes the decoded spec (keys in schema order), so hash the same bytes here.
const hashOf = async (spec: unknown) =>
  sha256Hex(JSON.stringify(Schema.is(ConceptSpec)(spec) ? spec : Schema.decodeUnknownSync(LessonSpec)(spec)))
const decodeConcept = Schema.decodeUnknownSync(ConceptSpec)

try {
  // Concepts, prerequisites first.
  const slugs = readdirSync(join(root, "content/concepts"))
  const specs = slugs.flatMap((s) =>
    ["en", "th"].map(
      (l) => read(`content/concepts/${s}/${l}.json`) as { slug: string; needs: Array<string> },
    ),
  )
  const done = new Set<string>()
  while (done.size < slugs.length) {
    const ready = slugs.filter(
      (s) =>
        !done.has(s) && specs.filter((c) => c.slug === s).every((c) => c.needs.every((n) => done.has(n))),
    )
    if (ready.length === 0) throw new Error("concept needs form a cycle or point outside content/concepts")
    for (const slug of ready) {
      const current = await worker
        .fetch(new Request(`http://localhost/api/concepts/${slug}`), env, ctx)
        .then((r) => (r.status === 200 ? (r.json() as Promise<{ langs: Array<{ spec: unknown }> }>) : null))
      for (const spec of specs.filter((c) => c.slug === slug)) {
        const same = await Promise.all((current?.langs ?? []).map((l) => sha256Hex(JSON.stringify(l.spec))))
        if (same.includes(await sha256Hex(JSON.stringify(decodeConcept(spec))))) continue
        await api("POST", "/api/concepts", spec)
        console.log(`concept ${slug} (${(spec as { lang: string }).lang}) published`)
      }
      done.add(slug)
    }
  }

  // The guide.
  const en = read("content/guide/en.json")
  const th = read("content/guide/th.json")
  const existing = await worker.fetch(
    new Request(`http://localhost/api/lessons/@${handle}/guide`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    env,
    ctx,
  )
  let lesson: { id: string; bodies: Array<{ lang: string; hash: string }> }
  if (existing.status === 404) {
    lesson = await api("POST", "/api/lessons", { slug: "guide", spec: en, note: "seed" })
    console.log("guide (en) created")
  } else lesson = (await existing.json()) as typeof lesson
  for (const spec of [en, th]) {
    const lang = (spec as { lang: string }).lang
    const current = lesson.bodies.find((b) => b.lang === lang)
    if (current?.hash === (await hashOf(spec))) continue
    lesson = await api("POST", `/api/lessons/${lesson.id}/versions`, { spec, note: "seed" })
    console.log(`guide (${lang}) published`)
  }
  await api("PATCH", `/api/lessons/${lesson.id}`, {
    visibility: "public",
    categoryId: "platform.guide",
    tags: ["guide", "getting-started"],
  })
  console.log(`done: http://localhost:5173/@${handle}/guide`)
} finally {
  await env.DB.prepare("delete from api_token where id = ?").bind(tokenId).run()
  await proxy.dispose()
}
