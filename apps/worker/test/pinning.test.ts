import { assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import {
  anonymous,
  conceptFiles,
  contentBytes,
  jsonBytes,
  readContent,
  signIn,
  TestLayer,
  tinyLesson,
} from "./support.ts"

layer(TestLayer, { excludeTestServices: true })("concept pinning", (it) => {
  it.effect("pins the concept version at lesson publish", () =>
    Effect.gen(function* () {
      const curator = yield* signIn("Concept Curator")
      const author = yield* signIn("Guide Writer")
      const anon = yield* anonymous()
      for (const slug of conceptFiles) {
        for (const lang of ["en", "th"] as const) {
          yield* curator.client.concepts.publish({ payload: contentBytes(`concepts/${slug}/${lang}.json`) })
        }
      }

      // The real guide lesson, en then th: its cards point at the three shared concepts.
      const en = yield* author.client.lessons.publish({
        params: { slug: "start-here" },
        payload: contentBytes("guide/en.json"),
      })
      const th = yield* author.client.lessons.publish({
        params: { slug: "start-here" },
        payload: contentBytes("guide/th.json"),
      })
      assert.strictEqual(th.version.n, 1)
      assert.strictEqual(th.lesson.langs.length, 2)

      const bundle = yield* author.client.lessons.concepts({
        params: { id: en.lesson.id, versionId: en.version.id },
      })
      assert.deepStrictEqual(
        bundle.items.map((item) => [item.card_id, item.slug, item.lang, item.n]),
        [
          ["avg_speed", "physics.average-speed", "en", 1],
          ["mean_speed", "physics.mean-speed-theorem", "en", 1],
          ["total_time", "physics.total-time", "en", 1],
        ],
      )
      assert.strictEqual(bundle.items[0]?.spec.card.title, "Average speed")
      const thBundle = yield* author.client.lessons.concepts({
        params: { id: th.lesson.id, versionId: th.version.id },
      })
      assert.isTrue(thBundle.items.every((item) => item.lang === "th"))

      // A lesson-level publish pins each language's concepts in the same batch.
      const both = yield* author.client.lessons.publishBundle({
        params: { slug: "start-here-bundle" },
        payload: jsonBytes({
          specs: [readContent("guide/en.json"), readContent("guide/th.json")],
        }),
      })
      assert.deepStrictEqual(
        both.versions.map((entry) => entry.version.lang),
        ["en", "th"],
      )
      for (const entry of both.versions) {
        const pinnedBundle = yield* author.client.lessons.concepts({
          params: { id: both.lesson.id, versionId: entry.version.id },
        })
        assert.isTrue(pinnedBundle.items.length > 0)
        assert.isTrue(pinnedBundle.items.every((item) => item.lang === entry.version.lang))
      }

      // A new concept version does not change what an existing lesson version shows…
      const v2 = yield* curator.client.concepts.publish({
        payload: jsonBytes({
          ...(readContent("concepts/physics.total-time/en.json") as object),
          aliases: ["elapsed time", "clock time", "wall time"],
        }),
      })
      assert.strictEqual(v2.n, 2)
      const pinned = yield* author.client.lessons.concepts({
        params: { id: en.lesson.id, versionId: en.version.id },
      })
      assert.strictEqual(pinned.items.find((item) => item.slug === "physics.total-time")?.n, 1)
      // …and the next lesson version picks up the current one.
      const en2 = yield* author.client.lessons.publish({
        params: { slug: "start-here" },
        payload: contentBytes("guide/en.json"),
      })
      assert.strictEqual(en2.version.n, 2)
      const repinned = yield* author.client.lessons.concepts({
        params: { id: en2.lesson.id, versionId: en2.version.id },
      })
      assert.strictEqual(repinned.items.find((item) => item.slug === "physics.total-time")?.n, 2)
      // Search sees the new alias.
      const hits = yield* anon.concepts.search({ query: { q: "wall time", lang: "en" } })
      assert.deepStrictEqual(
        hits.map((hit) => [hit.slug, hit.n]),
        [["physics.total-time", 2]],
      )

      // A card can name a version: `slug@1` stays on 1.
      const explicit = yield* author.client.lessons.publish({
        params: { slug: "pinned-explicitly" },
        payload: jsonBytes(tinyLesson("en", "pin", { cards: { tt: { concept: "physics.total-time@1" } } })),
      })
      const explicitBundle = yield* author.client.lessons.concepts({
        params: { id: explicit.lesson.id, versionId: explicit.version.id },
      })
      assert.deepStrictEqual(
        explicitBundle.items.map((item) => [item.card_id, item.n]),
        [["tt", 1]],
      )
      const missingVersion = yield* author.client.lessons
        .publish({
          params: { slug: "pinned-missing" },
          payload: jsonBytes(
            tinyLesson("en", "pin9", { cards: { tt: { concept: "physics.total-time@9" } } }),
          ),
        })
        .pipe(Effect.flip)
      assert.strictEqual(missingVersion._tag, "InvalidLesson")

      // The bundle follows the lesson's access rule: the guide is private, so others get a 404.
      const hidden = yield* anon.lessons
        .concepts({ params: { id: en.lesson.id, versionId: en.version.id } })
        .pipe(Effect.flip)
      assert.strictEqual(hidden._tag, "LessonNotFound")
      // A version of another lesson is not found under this one.
      const mismatched = yield* author.client.lessons
        .concepts({ params: { id: en.lesson.id, versionId: explicit.version.id } })
        .pipe(Effect.flip)
      assert.strictEqual(mismatched._tag, "VersionNotFound")
    }),
  )
})
