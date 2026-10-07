import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import { convertV4MiniflareOptions, Miniflare } from "miniflare"

// Thai search depends on Intl.Segmenter('th') splitting words inside workerd (not Node, where the
// other tests run): workerd must ship ICU's Thai word dictionary. This runs the segmenter in a real
// workerd isolate and the resulting text through FTS5 on D1.
describe("workerd", () => {
  it("splits Thai into words with Intl.Segmenter", async () => {
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        compatibilityDate: "2026-09-30",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        script: `export default {
          async fetch(request, env) {
            const segmenter = new Intl.Segmenter("th", { granularity: "word" })
            const words = (text) => [...segmenter.segment(text)].filter((s) => s.isWordLike).map((s) => s.segment)
            const indexed = words("อัตราเร็วเฉลี่ยคือระยะทางหารด้วยเวลาทั้งหมด").join(" ")
            await env.DB.exec("create virtual table t using fts5(search, tokenize = 'unicode61 remove_diacritics 2')")
            await env.DB.prepare("insert into t (search) values (?)").bind(indexed).run()
            const query = words("เวลาทั้งหมด").map((w) => '"' + w + '"').join(" ")
            const hits = await env.DB.prepare("select count(*) as n from t where t match ?").bind(query).first()
            return Response.json({ indexed, hits: hits.n })
          },
        }`,
      }),
    )
    try {
      const response = await mf.dispatchFetch("http://localhost/")
      const result = Schema.decodeUnknownSync(Schema.Struct({ indexed: Schema.String, hits: Schema.Number }))(
        await response.json(),
      )
      assert.include(result.indexed, "เฉลี่ย")
      assert.include(result.indexed, " ")
      assert.strictEqual(result.hits, 1)
    } finally {
      await mf.dispose()
    }
  })
})
