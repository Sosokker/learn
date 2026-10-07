import { assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import {
  anonymous,
  conceptFiles,
  contentBytes,
  jsonBytes,
  rawFetch,
  readContent,
  signIn,
  TestLayer,
} from "./support.ts"

const concept = (slug: string, lang: "en" | "th") => readContent(`concepts/${slug}/${lang}.json`)

layer(TestLayer, { excludeTestServices: true })("shared concepts", (it) => {
  it.effect("publishes, searches (English and Thai) and protects concepts", () =>
    Effect.gen(function* () {
      const author = yield* signIn("Concept Author")
      const stranger = yield* signIn("Concept Stranger")
      const anon = yield* anonymous()

      // A prerequisite must exist first.
      const early = yield* author.client.concepts
        .publish({ payload: contentBytes("concepts/physics.average-speed/en.json") })
        .pipe(Effect.flip)
      assert.strictEqual(early._tag, "InvalidConcept")

      for (const slug of conceptFiles) {
        for (const lang of ["en", "th"] as const) {
          const published = yield* author.client.concepts.publish({
            payload: contentBytes(`concepts/${slug}/${lang}.json`),
          })
          assert.strictEqual(published.n, 1)
        }
      }

      const average = yield* anon.concepts.get({ params: { slug: "physics.average-speed" } })
      assert.deepStrictEqual<ReadonlyArray<string>>(average.needs, ["physics.total-time"])
      assert.deepStrictEqual(
        average.langs.map((lang) => [lang.lang, lang.title]),
        [
          ["en", "Average speed"],
          ["th", "อัตราเร็วเฉลี่ย"],
        ],
      )
      // Concept bodies are public and immutable, like public lesson bodies.
      const body = yield* rawFetch(`/c/${average.langs[0]?.body_hash}.json`)
      assert.strictEqual(body.status, 200)

      const search = (q: string, lang?: "en" | "th") =>
        anon.concepts
          .search({ query: lang === undefined ? { q } : { q, lang } })
          .pipe(Effect.map((hits) => hits.map((hit) => `${hit.slug}/${hit.lang}`)))
      assert.include(yield* search("average speed", "en"), "physics.average-speed/en")
      assert.include(yield* search("Merton"), "physics.mean-speed-theorem/en")
      // Prefix match on the last word, as the user types.
      assert.include(yield* search("elap", "en"), "physics.total-time/en")
      // Thai has no spaces between words; both the index and the query are split with
      // Intl.Segmenter, so a word in the middle of a Thai phrase is found.
      assert.include(yield* search("เฉลี่ย", "th"), "physics.average-speed/th")
      assert.include(yield* search("เวลาทั้งหมด", "th"), "physics.total-time/th")
      assert.include(yield* search("กฎเมอร์ตัน"), "physics.mean-speed-theorem/th")
      // FTS syntax in user input is inert.
      assert.deepStrictEqual(yield* search('" OR * NEAR('), [])

      // Only the creator adds versions.
      const takeover = yield* stranger.client.concepts
        .publish({ payload: contentBytes("concepts/physics.total-time/en.json") })
        .pipe(Effect.flip)
      assert.strictEqual(takeover._tag, "ConceptForbidden")

      // The prerequisite graph stays acyclic.
      const cyclic = yield* author.client.concepts
        .publish({
          payload: jsonBytes({
            ...(concept("physics.total-time", "en") as object),
            needs: ["physics.mean-speed-theorem"],
          }),
        })
        .pipe(Effect.flip)
      assert.strictEqual(cyclic._tag, "InvalidConcept")
      if (cyclic._tag === "InvalidConcept") {
        assert.include(
          cyclic.issues.map((issue) => issue.code),
          "cycle",
        )
      }
      // Translations agree on needs.
      const drift = yield* author.client.concepts
        .publish({ payload: jsonBytes({ ...(concept("physics.average-speed", "th") as object), needs: [] }) })
        .pipe(Effect.flip)
      assert.strictEqual(drift._tag, "InvalidConcept")
    }),
  )
})
