import { assert, describe, it } from "@effect/vitest"
import { publishOrigin } from "../scripts/publish-origin.ts"

// scripts/publish.ts sends an API token: never over plain http to another machine.
describe("publish script origin", () => {
  it("allows https anywhere and http only for local hosts", () => {
    const origin = (raw: string) => {
      const result = publishOrigin(raw)
      return result.ok ? result.origin : undefined
    }
    assert.strictEqual(origin("https://learn.sirin.dev/"), "https://learn.sirin.dev")
    assert.strictEqual(origin("http://localhost:5187"), "http://localhost:5187")
    assert.strictEqual(origin("http://127.0.0.1:5187/"), "http://127.0.0.1:5187")
    assert.strictEqual(origin("http://[::1]:5187"), "http://[::1]:5187")
    assert.strictEqual(origin("http://learn.localhost"), "http://learn.localhost")
    for (const refused of [
      "http://learn.sirin.dev",
      "http://localhost.evil.example",
      "http://127.0.0.2",
      "ftp://learn.sirin.dev",
      "learn.sirin.dev",
    ]) {
      const result = publishOrigin(refused)
      assert.isFalse(result.ok, refused)
      if (!result.ok && refused.startsWith("http:")) assert.include(result.reason, "https", refused)
    }
  })
})
