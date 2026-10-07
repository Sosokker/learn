import { readdirSync } from "node:fs"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Env } from "../src/env.ts"
import { client, makeEnv, makeUser, readJson } from "./harness.ts"

// One database for the whole file: the steps build on each other like a real session.
let env: Env
let dispose: () => Promise<void>
let alice: Awaited<ReturnType<typeof makeUser>>
let bob: Awaited<ReturnType<typeof makeUser>>
const guideEn = readJson("content/guide/en.json") as {
  lang: string
  title: string
  cards: Record<string, unknown>
}
const guideTh = readJson("content/guide/th.json")
const conceptFiles = readdirSync(join(import.meta.dirname, "../../../content/concepts")).flatMap((slug) => [
  `content/concepts/${slug}/en.json`,
  `content/concepts/${slug}/th.json`,
])

beforeAll(async () => {
  ;({ env, dispose } = await makeEnv())
  alice = await makeUser(env, "alice")
  bob = await makeUser(env, "bob")
})
afterAll(() => dispose())

const anon = () => client(env)
const as = (u: { token: string }) => client(env, u.token)

let lessonId = ""
let enHash = ""

describe("api", () => {
  it("is up and lists categories", async () => {
    expect((await anon().get("/api/health")).json).toEqual({ ok: true })
    const cats = await anon().get("/api/categories")
    expect(cats.status).toBe(200)
    expect(cats.json.some((c: { id: string }) => c.id === "platform.guide")).toBe(true)
  })

  it("needs a user for private endpoints, and a bad token is anonymous", async () => {
    expect((await anon().get("/api/me")).status).toBe(401)
    expect((await client(env, "lrn_nope").get("/api/me")).status).toBe(401)
    const me = await as(alice).get("/api/me")
    expect(me.status).toBe(200)
    expect(me.json.handle).toBe("alice")
  })

  it("rejects a lesson whose shared concepts don't exist yet", async () => {
    const res = await as(alice).post("/api/lessons", { slug: "guide", spec: guideEn })
    expect(res.status).toBe(422)
    expect(res.json.issues.map((i: { message: string }) => i.message)).toContain(
      'unknown concept "physics.average-speed"',
    )
  })

  it("publishes shared concepts, in dependency order", async () => {
    // total-time has no needs; average-speed needs it; mean-speed-theorem needs average-speed.
    const order = ["physics.total-time", "physics.average-speed", "physics.mean-speed-theorem"]
    for (const slug of order)
      for (const f of conceptFiles.filter((c) => c.includes(`/${slug}/`))) {
        const res = await as(alice).post("/api/concepts", readJson(f))
        expect(res.status, `${f}: ${JSON.stringify(res.json)}`).toBe(200)
      }
    const found = await anon().get(`/api/concepts?q=${encodeURIComponent("average")}`)
    expect(found.json.map((c: { slug: string }) => c.slug)).toContain("physics.average-speed")
    // Thai search goes through Intl.Segmenter.
    const th = await anon().get(`/api/concepts?q=${encodeURIComponent("อัตราเร็ว")}&lang=th`)
    expect(th.json.length).toBeGreaterThan(0)
    expect(th.json[0].lang).toBe("th")
  })

  it("only the author can change a concept", async () => {
    const res = await as(bob).post("/api/concepts", readJson("content/concepts/physics.total-time/en.json"))
    expect(res.status).toBe(403)
  })

  it("creates a private lesson that only its owner can see", async () => {
    const res = await as(alice).post("/api/lessons", { slug: "guide", spec: guideEn })
    expect(res.status, JSON.stringify(res.json)).toBe(200)
    expect(res.json.visibility).toBe("private")
    expect(res.json.isOwner).toBe(true)
    lessonId = res.json.id
    enHash = res.json.bodies[0].hash
    const versionId = res.json.bodies[0].versionId

    expect((await as(alice).get("/api/lessons/@alice/guide")).status).toBe(200)
    for (const who of [anon(), as(bob)]) {
      expect((await who.get("/api/lessons/@alice/guide")).status).toBe(404)
      expect((await who.get(`/api/lessons/${lessonId}`)).status).toBe(404)
      expect((await who.get(`/api/lessons/${lessonId}/body/en`)).status).toBe(404)
      expect((await who.get(`/api/versions/${versionId}/concepts`)).status).toBe(404)
      expect((await who.get(`/c/${enHash}.json`)).status).toBe(404)
    }
    const body = await as(alice).get(`/api/lessons/${lessonId}/body/en`)
    expect(body.json.title).toBe(guideEn.title)
    // The owner reads a private body through the API, never through /c/.
    expect((await as(alice).get(`/c/${enHash}.json`)).status).toBe(404)
  })

  it("pins concepts and their prerequisites with the version", async () => {
    const detail = await as(alice).get(`/api/lessons/${lessonId}`)
    const bundle = await as(alice).get(`/api/versions/${detail.json.bodies[0].versionId}/concepts`)
    const slugs = bundle.json.concepts.map((c: { slug: string }) => c.slug).sort()
    expect(slugs).toEqual(["physics.average-speed", "physics.mean-speed-theorem", "physics.total-time"])
    expect(bundle.json.concepts.every((c: { spec: { lang: string } }) => c.spec.lang === "en")).toBe(true)
    const used = await anon().get("/api/concepts/physics.average-speed")
    expect(used.json.useCount).toBe(1)
  })

  it("does not let another user change or delete it", async () => {
    expect((await as(bob).patch(`/api/lessons/${lessonId}`, { visibility: "public" })).status).toBe(404)
    expect((await as(bob).del(`/api/lessons/${lessonId}`)).status).toBe(404)
    expect((await as(bob).post(`/api/lessons/${lessonId}/versions`, { spec: guideEn })).status).toBe(404)
  })

  it("refuses a duplicate slug", async () => {
    expect((await as(alice).post("/api/lessons", { slug: "guide", spec: guideEn })).status).toBe(409)
  })

  it("adds a translation only if it shares every id", async () => {
    const broken = structuredClone(guideTh) as { parts: Record<string, unknown> }
    broken.parts.extra = broken.parts.d
    const bad = await as(alice).post(`/api/lessons/${lessonId}/versions`, { spec: broken })
    expect(bad.status).toBe(422)
    expect(bad.json.issues).toContainEqual({ path: "part:extra", message: "missing in en" })
    const ok = await as(alice).post(`/api/lessons/${lessonId}/versions`, { spec: guideTh })
    expect(ok.status, JSON.stringify(ok.json)).toBe(200)
    expect([...ok.json.langs].sort()).toEqual(["en", "th"])
  })

  it("serves an unlisted lesson by link but keeps it out of feeds", async () => {
    const res = await as(alice).patch(`/api/lessons/${lessonId}`, { visibility: "unlisted" })
    expect(res.status).toBe(200)
    const read = await anon().get("/api/lessons/@alice/guide")
    expect(read.status).toBe(200)
    expect(read.json.isOwner).toBe(false)
    const c = await anon().get(`/c/${enHash}.json`)
    expect(c.status).toBe(200)
    expect(c.json.title).toBe(guideEn.title)
    expect((await anon().get("/api/feed")).json.items).toEqual([])
  })

  it("needs a category and a tag to go public", async () => {
    const res = await as(alice).patch(`/api/lessons/${lessonId}`, { visibility: "public" })
    expect(res.status).toBe(422)
    expect(res.json.issues.map((i: { path: string }) => i.path).sort()).toEqual(["categoryId", "tags"])
    const unknown = await as(alice).patch(`/api/lessons/${lessonId}`, { categoryId: "nope", tags: ["x"] })
    expect(unknown.status).toBe(422)
    const ok = await as(alice).patch(`/api/lessons/${lessonId}`, {
      visibility: "public",
      categoryId: "platform.guide",
      tags: ["Getting Started", "physics"],
    })
    expect(ok.status, JSON.stringify(ok.json)).toBe(200)
    expect(ok.json.tags.sort()).toEqual(["getting-started", "physics"])
    expect(ok.json.publishedAt).toBeTypeOf("number")
  })

  it("lists public lessons in feeds, filters and search", async () => {
    const feed = await anon().get("/api/feed")
    expect(feed.json.items.map((l: { slug: string }) => l.slug)).toEqual(["guide"])
    expect(feed.json.items[0].owner.handle).toBe("alice")
    const q = (s: string) => anon().get(`/api/feed?${s}`)
    expect((await q("tag=physics")).json.items).toHaveLength(1)
    expect((await q("tag=chemistry")).json.items).toHaveLength(0)
    expect((await q("categories=platform.guide,platform")).json.items).toHaveLength(1)
    expect((await q("categories=math")).json.items).toHaveLength(0)
    expect((await q("kind=guide&lang=th")).json.items).toHaveLength(1)
    expect((await q("kind=solve")).json.items).toHaveLength(0)
    expect((await q(`q=${encodeURIComponent("train")}`)).json.items).toHaveLength(1)
    expect((await q(`q=${encodeURIComponent("tour")}`)).json.items).toHaveLength(1)
    expect((await q(`q=${encodeURIComponent("zebra")}`)).json.items).toHaveLength(0)
    expect((await q("sort=hot")).json.items).toHaveLength(1)
    const tags = await anon().get("/api/tags?prefix=phy")
    expect(tags.json).toEqual([{ slug: "physics", lessonCount: 1 }])
  })

  it("pages with a keyset cursor", async () => {
    for (let i = 0; i < 21; i++) {
      const spec = { ...guideEn, title: `Copy ${i}`, kind: "guide" }
      const res = await as(bob).post("/api/lessons", { slug: `copy-${i}`, spec })
      expect(res.status, JSON.stringify(res.json)).toBe(200)
      await as(bob).patch(`/api/lessons/${res.json.id}`, {
        visibility: "public",
        categoryId: "physics.mechanics",
        tags: ["copy"],
      })
    }
    const first = await anon().get("/api/feed")
    expect(first.json.items).toHaveLength(20)
    expect(first.json.next).toBeTypeOf("string")
    const second = await anon().get(`/api/feed?cursor=${first.json.next}`)
    expect(second.json.items).toHaveLength(2)
    expect(second.json.next).toBeNull()
    const ids = [...first.json.items, ...second.json.items].map((l: { id: string }) => l.id)
    expect(new Set(ids).size).toBe(22)
    const lib = await as(bob).get("/api/library")
    expect(lib.json.items).toHaveLength(20)
    expect((await as(bob).get(`/api/library?cursor=${lib.json.next}`)).json.items).toHaveLength(1)
  })

  it("manages API tokens", async () => {
    const made = await as(alice).post("/api/me/tokens", { name: "laptop" })
    expect(made.json.token).toMatch(/^lrn_/)
    expect((await client(env, made.json.token).get("/api/me")).json.handle).toBe("alice")
    expect((await as(alice).del(`/api/me/tokens/${made.json.id}`)).status).toBe(204)
    expect((await client(env, made.json.token).get("/api/me")).status).toBe(401)
    expect((await as(bob).del(`/api/me/tokens/${made.json.id}`)).status).toBe(404)
  })

  it("updates the handle, refusing one that is taken", async () => {
    expect((await as(bob).patch("/api/me", { handle: "alice" })).status).toBe(409)
    expect((await as(bob).patch("/api/me", { handle: "bobby", bio: "hi" })).json).toMatchObject({
      handle: "bobby",
      bio: "hi",
    })
  })

  it("deletes a lesson for everyone", async () => {
    expect((await as(alice).del(`/api/lessons/${lessonId}`)).status).toBe(204)
    expect((await as(alice).get(`/api/lessons/${lessonId}`)).status).toBe(404)
    expect((await anon().get("/api/lessons/@alice/guide")).status).toBe(404)
    expect((await anon().get(`/c/${enHash}.json`)).status).toBe(404)
    expect((await anon().get("/api/feed?tag=physics")).json.items).toHaveLength(0)
    expect((await anon().get("/api/tags?prefix=phy")).json).toEqual([{ slug: "physics", lessonCount: 0 }])
    expect((await anon().get("/api/concepts/physics.average-speed")).json.useCount).toBe(21)
  })
})
