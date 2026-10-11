import { HotScore } from "@app/services"
import { assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import { anonymous, jsonBytes, rawFetch, signIn, TestEnv, TestLayer, tinyLesson } from "./support.ts"

const publishRaw = (cookie: string, slug: string, body: string) =>
  rawFetch(`/api/me/lessons/${slug}/versions`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body,
  })

const issueCodes = (error: { readonly issues: ReadonlyArray<{ readonly code: string }> }) =>
  error.issues.map((issue) => issue.code)

layer(TestLayer, { excludeTestServices: true })("publish rules", (it) => {
  it.effect("refuses bodies that are too big, not JSON, off-schema or with broken references", () =>
    Effect.gen(function* () {
      const author = yield* signIn("Rule Tester")

      // 512 KB is the cap, checked before the body is read.
      const huge = yield* publishRaw(author.cookie, "huge", JSON.stringify({ pad: "x".repeat(512 * 1024) }))
      assert.strictEqual(huge.status, 413)

      const notJson = yield* author.client.lessons
        .publish({ params: { slug: "broken" }, payload: new TextEncoder().encode("{ not json") })
        .pipe(Effect.flip)
      assert.strictEqual(notJson._tag, "InvalidLesson")
      if (notJson._tag === "InvalidLesson") assert.deepStrictEqual(issueCodes(notJson), ["json"])

      const { title: _title, ...untitled } = tinyLesson("en", "untitled")
      const offSchema = yield* author.client.lessons
        .publish({ params: { slug: "untitled" }, payload: jsonBytes(untitled) })
        .pipe(Effect.flip)
      assert.strictEqual(offSchema._tag, "InvalidLesson")
      if (offSchema._tag === "InvalidLesson") assert.deepStrictEqual(issueCodes(offSchema), ["schema"])

      // Strict decoding: a misspelled key is an error, not silently dropped.
      const typo = yield* author.client.lessons
        .publish({
          params: { slug: "typo" },
          payload: jsonBytes({ ...tinyLesson("en", "typo"), sumary: "x" }),
        })
        .pipe(Effect.flip)
      assert.strictEqual(typo._tag, "InvalidLesson")

      const danglingPart = yield* author.client.lessons
        .publish({
          params: { slug: "dangling" },
          payload: jsonBytes(
            tinyLesson("en", "dangling", {
              sections: [{ id: "intro", type: "text", body: "See [nope:this]." }],
            }),
          ),
        })
        .pipe(Effect.flip)
      assert.strictEqual(danglingPart._tag, "InvalidLesson")
      if (danglingPart._tag === "InvalidLesson") assert.include(issueCodes(danglingPart), "unknown_part")

      const unknownConcept = yield* author.client.lessons
        .publish({
          params: { slug: "unknown-concept" },
          payload: jsonBytes(
            tinyLesson("en", "uc", { cards: { law: { concept: "physics.does-not-exist" } } }),
          ),
        })
        .pipe(Effect.flip)
      assert.strictEqual(unknownConcept._tag, "InvalidLesson")
      if (unknownConcept._tag === "InvalidLesson")
        assert.include(issueCodes(unknownConcept), "unknown_concept")

      // Nothing was created by any refused publish.
      const mine = yield* author.client.lessons.mine({ query: {} })
      assert.strictEqual(mine.items.length, 0)
    }),
  )

  it.effect("numbers versions per language and keeps translations in step", () =>
    Effect.gen(function* () {
      const author = yield* signIn("Version Counter")
      const env = yield* TestEnv
      const publish = (body: unknown) =>
        author.client.lessons.publish({ params: { slug: "speed" }, payload: jsonBytes(body) })

      const en1 = yield* publish(tinyLesson("en", "one"))
      const en2 = yield* publish(tinyLesson("en", "two"))
      const th1 = yield* publish(tinyLesson("th", "หนึ่ง"))
      const en3 = yield* publish(tinyLesson("en", "three"))
      assert.deepStrictEqual(
        [en1, en2, th1, en3].map((published) => `${published.version.lang}${published.version.n}`),
        ["en1", "en2", "th1", "en3"],
      )
      assert.strictEqual(new Set([en1, en2, th1, en3].map((published) => published.lesson.id)).size, 1)

      const lesson = en3.lesson
      assert.strictEqual(lesson.default_lang, "en")
      assert.strictEqual(lesson.title, "Tiny three")
      assert.deepStrictEqual(
        lesson.langs.map((lang) => [lang.lang, lang.n, lang.version_id]),
        [
          ["en", 3, en3.version.id],
          ["th", 1, th1.version.id],
        ],
      )
      const thVersions = yield* author.client.lessons.versions({
        params: { id: lesson.id },
        query: { lang: "th" },
      })
      assert.deepStrictEqual(
        thVersions.map((version) => version.n),
        [1],
      )
      const allVersions = yield* author.client.lessons.versions({ params: { id: lesson.id }, query: {} })
      assert.strictEqual(allVersions.length, 4)

      // Old versions stay readable; the body is the stored, canonical JSON.
      const old = yield* author.client.lessons.body({ params: { id: lesson.id, versionId: en1.version.id } })
      assert.strictEqual(old.title, "Tiny one")

      // The current body again is a no-op: 200, the current version back, nothing written.
      const before = (yield* Effect.promise(() => env.bucket.list())).objects.length
      assert.isTrue(en3.created)
      const again = yield* publish(tinyLesson("en", "three"))
      assert.isFalse(again.created)
      assert.strictEqual(again.version.id, en3.version.id)
      assert.strictEqual(again.lesson.updated_at, en3.lesson.updated_at)
      const raw = yield* publishRaw(author.cookie, "speed", JSON.stringify(tinyLesson("en", "three")))
      assert.strictEqual(raw.status, 200)
      // Key order and spacing do not matter: the hash is of the canonical JSON.
      const reordered = Object.fromEntries(Object.entries(tinyLesson("en", "three")).reverse())
      assert.isFalse((yield* publish(reordered)).created)
      const th = yield* publish(tinyLesson("th", "หนึ่ง"))
      assert.strictEqual(th.version.id, th1.version.id)
      assert.strictEqual(
        (yield* author.client.lessons.versions({ params: { id: lesson.id }, query: {} })).length,
        4,
      )

      // An older body is a new version that points at the same stored object.
      const en4 = yield* publish(tinyLesson("en", "two"))
      assert.isTrue(en4.created)
      assert.strictEqual(en4.version.n, 4)
      assert.strictEqual(en4.version.body_hash, en2.version.body_hash)
      assert.strictEqual((yield* Effect.promise(() => env.bucket.list())).objects.length, before)

      // A translation must have the same structure as the other language.
      const drifted = yield* publish(
        tinyLesson("th", "ต่าง", { sections: [{ id: "other", type: "text", body: "ดู [x:$x$]" }] }),
      ).pipe(Effect.flip)
      assert.strictEqual(drifted._tag, "InvalidLesson")
      if (drifted._tag === "InvalidLesson") assert.include(issueCodes(drifted), "parity")

      // A lesson keeps its kind.
      const otherKind = yield* publish({ ...tinyLesson("en", "kind"), kind: "solve" }).pipe(Effect.flip)
      assert.strictEqual(otherKind._tag, "InvalidLesson")
      if (otherKind._tag === "InvalidLesson") assert.include(issueCodes(otherKind), "parity")

      // A refused publish adds nothing.
      const after = yield* author.client.lessons.versions({ params: { id: lesson.id }, query: {} })
      assert.strictEqual(after.length, 5)
    }),
  )

  it.effect("needs a category and a tag to go public; normalizes and caps tags", () =>
    Effect.gen(function* () {
      const author = yield* signIn("Public Author")
      const env = yield* TestEnv
      const anon = yield* anonymous()
      const published = yield* author.client.lessons.publish({
        params: { slug: "going-public" },
        payload: jsonBytes(tinyLesson("en", "public")),
      })
      const id = published.lesson.id
      const update = (payload: Parameters<typeof author.client.lessons.update>[0]["payload"]) =>
        author.client.lessons.update({ params: { id }, payload })

      const noCategory = yield* update({ visibility: "public" }).pipe(Effect.flip)
      assert.strictEqual(noCategory._tag, "InvalidSettings")
      if (noCategory._tag === "InvalidSettings") {
        assert.include(noCategory.message, "a category")
        assert.include(noCategory.message, "at least one tag")
      }
      const noTag = yield* update({ visibility: "public", category_id: "physics.mechanics" }).pipe(
        Effect.flip,
      )
      assert.strictEqual(noTag._tag, "InvalidSettings")
      if (noTag._tag === "InvalidSettings") assert.notInclude(noTag.message, "a category")
      // A refused update changes nothing.
      assert.strictEqual((yield* author.client.lessons.get({ params: { id } })).category_id, null)

      const unknownCategory = yield* update({ category_id: "physics.alchemy" }).pipe(Effect.flip)
      assert.strictEqual(unknownCategory._tag, "InvalidSettings")
      const emptyTag = yield* update({ tags: ["!!!"] }).pipe(Effect.flip)
      assert.strictEqual(emptyTag._tag, "InvalidSettings")

      // Six tags fail request decoding (400) before reaching the service.
      const tooMany = yield* rawFetch(`/api/lessons/${id}`, {
        method: "PATCH",
        headers: { cookie: author.cookie, "content-type": "application/json" },
        body: JSON.stringify({ tags: ["a", "b", "c", "d", "e", "f"] }),
      })
      assert.strictEqual(tooMany.status, 400)

      const lesson = yield* update({
        visibility: "public",
        category_id: "physics.mechanics",
        tags: ["  Linear Algebra ", "linear-algebra", "พีชคณิต เชิงเส้น", "Friction!"],
      })
      assert.strictEqual(lesson.visibility, "public")
      assert.sameMembers([...lesson.tags], ["linear-algebra", "พีชคณิต-เชิงเส้น", "friction"])
      assert.isNotNull(lesson.published_at)

      // Counters: public lessons per tag and per author.
      const counts = yield* Effect.promise(() =>
        env.db
          .prepare("select slug, lesson_count from tag order by slug")
          .all<{ slug: string; lesson_count: number }>(),
      )
      assert.deepStrictEqual(
        counts.results.filter((row) => lesson.tags.includes(row.slug)).map((row) => row.lesson_count),
        [1, 1, 1],
      )
      const me = yield* author.client.me.get()
      assert.strictEqual(me.lesson_count, 1)

      // The category feed includes sub-categories; the parent finds it.
      const physics = yield* anon.feeds.category({ params: { id: "physics" }, query: {} })
      assert.deepStrictEqual(
        physics.items.map((item) => item.id),
        [id],
      )
      const thaiTag = yield* anon.feeds.tag({ params: { slug: "พีชคณิต เชิงเส้น" }, query: {} })
      assert.strictEqual(thaiTag.items.length, 1)

      // Dropping a tag and going private recounts.
      yield* update({ visibility: "private", tags: ["friction"] })
      const after = yield* Effect.promise(() =>
        env.db
          .prepare("select slug, lesson_count from tag order by slug")
          .all<{ slug: string; lesson_count: number }>(),
      )
      assert.isTrue(after.results.every((row) => row.lesson_count === 0))
      assert.strictEqual((yield* author.client.me.get()).lesson_count, 0)
    }),
  )

  it.effect("pages the public feed with a keyset cursor and keeps hot scores fresh", () =>
    Effect.gen(function* () {
      const author = yield* signIn("Feed Author")
      const env = yield* TestEnv
      const anon = yield* anonymous()
      const ids: Array<string> = []
      for (const slug of ["first", "second", "third"]) {
        const published = yield* author.client.lessons.publish({
          params: { slug },
          payload: jsonBytes(tinyLesson("en", slug)),
        })
        yield* author.client.lessons.update({
          params: { id: published.lesson.id },
          payload: { visibility: "public", category_id: "math.algebra", tags: ["paging"] },
        })
        ids.push(published.lesson.id)
      }
      const page1 = yield* anon.feeds.tag({ params: { slug: "paging" }, query: { limit: 2 } })
      assert.strictEqual(page1.items.length, 2)
      assert.isNotNull(page1.next_cursor)
      const page2 = yield* anon.feeds.tag({
        params: { slug: "paging" },
        query: { limit: 2, ...(page1.next_cursor === null ? {} : { cursor: page1.next_cursor }) },
      })
      assert.strictEqual(page2.items.length, 1)
      assert.isNull(page2.next_cursor)
      assert.sameMembers(
        [...page1.items, ...page2.items].map((item) => item.id),
        ids,
      )
      // Newest first.
      assert.strictEqual(page1.items[0]?.id, ids[2])

      const latest = yield* anon.feeds.new({ query: { limit: 2 } })
      assert.strictEqual(latest.items.length, 2)
      assert.deepStrictEqual(latest.items[0]?.langs, ["en"])
      assert.deepStrictEqual(latest.items[0]?.tags, ["paging"])

      // The cron recomputes hot scores and copies them to the tag index.
      const hot = yield* HotScore
      yield* hot.recompute(Date.now() + 60 * 60 * 1000)
      const scores = yield* Effect.promise(() =>
        env.db
          .prepare(
            "select l.hot_score as lesson_score, lt.hot_score as tag_score from lesson l join lesson_tag lt on lt.lesson_id = l.id where l.id = ?",
          )
          .bind(ids[0])
          .first<{ lesson_score: number; tag_score: number }>(),
      )
      assert.isNotNull(scores)
      if (scores !== null) {
        // (0 + 0 + 0 + 1) / (1 h + 2)^1.5 ≈ 0.19245
        assert.closeTo(scores.lesson_score, 1 / 3 ** 1.5, 0.001)
        assert.strictEqual(scores.tag_score, scores.lesson_score)
      }
    }),
  )
})
