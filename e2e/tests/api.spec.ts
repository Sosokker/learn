import { randomBytes } from "node:crypto"
import { expect, test } from "@playwright/test"

test("anonymous /api/me is 401", async ({ request }) => {
  const res = await request.get("/api/me")
  expect(res.status()).toBe(401)
})

test("/c/<hash> of the public guide is 200 and immutable; an unknown hash is 404", async ({ request }) => {
  const lesson = await request.get("/api/lessons/by/learn/start-here")
  expect(lesson.status()).toBe(200)
  const body: unknown = await lesson.json()
  const hashes =
    typeof body === "object" && body !== null && "langs" in body && Array.isArray(body.langs)
      ? body.langs.flatMap((l: unknown) =>
          typeof l === "object" && l !== null && "body_hash" in l && typeof l.body_hash === "string"
            ? [l.body_hash]
            : [],
        )
      : []
  expect(hashes.length).toBeGreaterThanOrEqual(2)

  for (const hash of hashes) {
    const res = await request.get(`/c/${hash}.json`)
    expect(res.status()).toBe(200)
    expect(res.headers()["cache-control"]).toBe("public, max-age=31536000, immutable")
    expect(res.headers()["content-type"]).toContain("application/json")
    const spec: unknown = await res.json()
    expect(spec).toMatchObject({ kind: "guide" })
  }

  const missing = await request.get(`/c/${randomBytes(32).toString("hex")}.json`)
  expect(missing.status()).toBe(404)
  expect(missing.headers()["cache-control"]).toBe("no-store")
})
