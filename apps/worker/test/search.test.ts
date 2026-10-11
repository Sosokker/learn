import type { LessonId } from "@app/api"
import { Database } from "@app/db"
import { LessonSearch, repairConceptFts } from "@app/services"
import { assert, layer } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { anonymous, jsonBytes, readContent, signIn, TestEnv, TestLayer, tinyLesson } from "./support.ts"

const ids = (page: { readonly items: ReadonlyArray<{ readonly id: string }> }) =>
  page.items.map((item) => item.id)

layer(TestLayer, { excludeTestServices: true })("lesson search and feeds", (it) => {
  it.effect("finds public lessons in English and Thai, and only while they are public", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const author = yield* signIn("Search Writer")
      const anon = yield* anonymous()
      const ftsRows = () =>
        Effect.promise(() =>
          env.db.prepare("select count(*) as n from lesson_fts").first<{ n: number }>(),
        ).pipe(Effect.map((row) => row?.n ?? 0))
      const search = (q: string, lang?: "en" | "th") =>
        anon.lessons.search({ query: lang === undefined ? { q } : { q, lang } })
      const found = (q: string, lang?: "en" | "th") => search(q, lang).pipe(Effect.map(ids))

      const en = {
        title: "Projectile motion basics",
        summary: "How a thrown ball moves under gravity",
      }
      const th = {
        title: "พื้นฐานการเคลื่อนที่แบบโพรเจกไทล์",
        summary: "ลูกบอลที่ถูกขว้างเคลื่อนที่อย่างไรภายใต้แรงโน้มถ่วง",
      }
      const first = yield* author.client.lessons.publish({
        params: { slug: "projectile" },
        payload: jsonBytes({ ...tinyLesson("en", "p1"), ...en }),
      })
      const id = first.lesson.id
      yield* author.client.lessons.publish({
        params: { slug: "projectile" },
        payload: jsonBytes({ ...tinyLesson("th", "p1"), ...th }),
      })
      const update = (payload: Parameters<typeof author.client.lessons.update>[0]["payload"]) =>
        author.client.lessons.update({ params: { id }, payload })

      // Private: not indexed at all.
      assert.deepStrictEqual(yield* found("projectile"), [])
      assert.strictEqual(yield* ftsRows(), 0)

      yield* update({ visibility: "public", category_id: "physics.mechanics", tags: ["motion"] })
      assert.strictEqual(yield* ftsRows(), 2)
      assert.deepStrictEqual(yield* found("projectile"), [id])
      // Prefix match on the last word; summary words count.
      assert.deepStrictEqual(yield* found("thrown gra"), [id])
      // Thai: a word from the middle of a phrase with no spaces.
      assert.deepStrictEqual(yield* found("แรงโน้มถ่วง"), [id])
      assert.deepStrictEqual(yield* found("เคลื่อนที่", "th"), [id])
      assert.deepStrictEqual(yield* found("เคลื่อนที่", "en"), [])
      // A hit shows the language that matched; one lesson is one hit.
      const thaiHit = yield* search("ลูกบอล")
      assert.strictEqual(thaiHit.items[0]?.title, th.title)
      const englishHit = yield* search("ball")
      assert.strictEqual(englishHit.items[0]?.title, en.title)
      assert.sameMembers([...(englishHit.items[0]?.langs ?? [])], ["en", "th"])
      // FTS syntax in user input is inert.
      assert.deepStrictEqual(yield* found('" OR * NEAR('), [])

      // A new version replaces its language's indexed text.
      yield* author.client.lessons.publish({
        params: { slug: "projectile" },
        payload: jsonBytes({ ...tinyLesson("en", "p1"), ...en, summary: "Parabolas and launch angles" }),
      })
      assert.deepStrictEqual(yield* found("ball", "en"), [])
      assert.deepStrictEqual(yield* found("parabolas"), [id])
      assert.strictEqual(yield* ftsRows(), 2)

      // Leaves the index with its visibility, comes back with it, and leaves for good on delete.
      yield* update({ visibility: "unlisted" })
      assert.deepStrictEqual(yield* found("projectile"), [])
      assert.strictEqual(yield* ftsRows(), 0)
      yield* update({ visibility: "public" })
      assert.deepStrictEqual(yield* found("projectile"), [id])
      yield* update({ visibility: "private" })
      assert.deepStrictEqual(yield* found("projectile"), [])
      yield* update({ visibility: "public" })
      yield* author.client.lessons.delete({ params: { id } })
      assert.deepStrictEqual(yield* found("projectile"), [])
      assert.deepStrictEqual(yield* found("แรงโน้มถ่วง"), [])
      assert.strictEqual(yield* ftsRows(), 0)
    }),
  )

  it.effect("fills the search text of rows from before the search migration", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const author = yield* signIn("Legacy Writer")
      const anon = yield* anonymous()
      const published = yield* author.client.lessons.publish({
        params: { slug: "legacy" },
        payload: jsonBytes({ ...tinyLesson("th", "legacy"), title: "ความเร่งคงที่" }),
      })
      yield* author.client.lessons.update({
        params: { id: published.lesson.id },
        payload: { visibility: "public", category_id: "physics", tags: ["legacy"] },
      })
      // What migration 0008 leaves: no search text, no FTS row.
      yield* Effect.promise(() =>
        env.db.batch([
          env.db
            .prepare("update lesson_lang set search = null where lesson_id = ?")
            .bind(published.lesson.id),
          env.db.prepare("delete from lesson_fts"),
        ]),
      )
      const found = () => anon.lessons.search({ query: { q: "ความเร่ง" } }).pipe(Effect.map(ids))
      assert.deepStrictEqual(yield* found(), [])
      const filled = yield* LessonSearch.use((search) => search.backfill(100))
      assert.strictEqual(filled, 1)
      assert.deepStrictEqual(yield* found(), [published.lesson.id])
      assert.strictEqual(yield* LessonSearch.use((search) => search.backfill(100)), 0)
      yield* author.client.lessons.delete({ params: { id: published.lesson.id } })
    }),
  )

  it.effect("keeps lesson FTS rowids unique after rows an older Worker wrote during a deploy", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const author = yield* signIn("Deploy Writer")
      const anon = yield* anonymous()
      const sqlOne = <T>(query: string, ...params: ReadonlyArray<unknown>) =>
        Effect.promise(() =>
          env.db
            .prepare(query)
            .bind(...params)
            .first<T>(),
        )
      const make = (slug: string, title: string) =>
        Effect.gen(function* () {
          const published = yield* author.client.lessons.publish({
            params: { slug },
            payload: jsonBytes({ ...tinyLesson("en", slug), title }),
          })
          yield* author.client.lessons.update({
            params: { id: published.lesson.id },
            payload: { visibility: "public", category_id: "math", tags: ["deploy"] },
          })
          return published.lesson.id
        })
      const found = (q: string) => anon.lessons.search({ query: { q } }).pipe(Effect.map(ids))

      const first = yield* make("deploy-one", "Pendulumword basics")
      const second = yield* make("deploy-two", "Gyroscopeword basics")
      // What the Worker from before migration 0007 leaves when it publishes after the migrations:
      // a lesson_lang row with no search text, no fts_rowid and no FTS row.
      yield* Effect.promise(() =>
        env.db.batch([
          env.db
            .prepare(
              "delete from lesson_fts where rowid = (select fts_rowid from lesson_lang where lesson_id = ?)",
            )
            .bind(second),
          env.db
            .prepare("update lesson_lang set search = null, fts_rowid = null where lesson_id = ?")
            .bind(second),
        ]),
      )
      assert.isAtLeast(yield* LessonSearch.use((search) => search.backfill(50)), 1)
      // The backfill gave the row an fts_rowid, and its FTS row that same rowid.
      const nulls = yield* sqlOne<{ n: number }>(
        "select count(*) as n from lesson_lang where fts_rowid is null",
      )
      assert.strictEqual(nulls?.n, 0)
      assert.deepStrictEqual(yield* found("gyroscopeword"), [second])

      // A stray FTS row with an automatic rowid (max + 1) must not collide with the next lesson.
      yield* sqlOne("insert into lesson_fts (lesson_id, lang, search) values ('stray', 'en', 'straywordx')")
      const third = yield* make("deploy-three", "Flywheelword basics")
      assert.deepStrictEqual(yield* found("flywheelword"), [third])
      assert.deepStrictEqual(yield* found("pendulumword"), [first])
      yield* sqlOne("delete from lesson_fts where lesson_id = 'stray'")

      // Each lesson's FTS row goes with it: no duplicate or orphan rows.
      yield* author.client.lessons.update({ params: { id: second }, payload: { visibility: "private" } })
      assert.deepStrictEqual(yield* found("gyroscopeword"), [])
      const orphans = yield* sqlOne<{ n: number }>(
        "select count(*) as n from lesson_fts where rowid not in (select fts_rowid from lesson_lang where is_public = 1)",
      )
      assert.strictEqual(orphans?.n, 0)
      for (const id of [first, second, third]) yield* author.client.lessons.delete({ params: { id } })
    }),
  )

  it.effect("repairs concept FTS rows an older Worker wrote during a deploy", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const author = yield* signIn("Deploy Concepts")
      const anon = yield* anonymous()
      const exec = (query: string, ...params: ReadonlyArray<unknown>) =>
        Effect.promise(() =>
          env.db
            .prepare(query)
            .bind(...params)
            .run(),
        )
      const count = (query: string) =>
        Effect.promise(() => env.db.prepare(query).first<{ n: number }>()).pipe(Effect.map((row) => row?.n))
      const base = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(
        readContent("concepts/physics.total-time/en.json"),
      )
      const publish = (slug: string, alias: string) =>
        author.client.concepts.publish({ payload: jsonBytes({ ...base, slug, aliases: [alias] }) })
      const idOf = (slug: string) =>
        Effect.promise(() =>
          env.db.prepare("select id from concept where slug = ?").bind(slug).first<{ id: string }>(),
        ).pipe(Effect.map((row) => row?.id ?? ""))
      const found = (q: string) =>
        anon.concepts.search({ query: { q } }).pipe(Effect.map((hits) => hits.map((hit) => hit.slug)))
      // What the old Worker does on publish: deletes the FTS rows by concept and inserts one with
      // an automatic rowid; a new concept_lang row gets no fts_rowid.
      const oldPublish = (id: string, search: string, isNew: boolean) =>
        Effect.gen(function* () {
          yield* exec("delete from concept_fts where concept_id = ? and lang = 'en'", id)
          yield* exec(
            `update concept_lang set search = ?${isNew ? ", fts_rowid = null" : ""} where concept_id = ? and lang = 'en'`,
            search,
            id,
          )
          yield* exec("insert into concept_fts (concept_id, lang, search) values (?, 'en', ?)", id, search)
        })
      const consistent = Effect.gen(function* () {
        assert.strictEqual(yield* count("select count(*) as n from concept_lang where fts_rowid is null"), 0)
        assert.strictEqual(
          yield* count(
            "select count(*) as n from concept_fts where rowid not in (select fts_rowid from concept_lang)",
          ),
          0,
        )
        assert.strictEqual(
          yield* count("select count(*) as n from concept_fts"),
          yield* count("select count(*) as n from concept_lang"),
        )
      })

      yield* publish("drill.xray", "xraywordone")
      yield* publish("drill.yoke", "yokewordone")
      yield* publish("drill.zinc", "zincwordone")
      // The old Worker publishes a new concept (zinc stands in for it) and a new version of xray.
      yield* oldPublish(yield* idOf("drill.zinc"), "drill zinc zincwordone", true)
      yield* oldPublish(yield* idOf("drill.xray"), "drill xray xraywordtwo", false)

      // The new Worker publishes a new concept: no rowid collision, and the old rows are repaired.
      yield* publish("drill.quartz", "quartzwordone")
      yield* consistent
      assert.deepStrictEqual(yield* found("quartzwordone"), ["drill.quartz"])
      assert.deepStrictEqual(yield* found("zincwordone"), ["drill.zinc"])
      assert.deepStrictEqual(yield* found("xraywordtwo"), ["drill.xray"])
      assert.deepStrictEqual(yield* found("xraywordone"), [])

      // The cron repairs the same without a publish.
      yield* oldPublish(yield* idOf("drill.yoke"), "drill yoke yokewordtwo", true)
      yield* oldPublish(yield* idOf("drill.quartz"), "drill quartz quartzwordtwo", false)
      yield* Database.use(repairConceptFts)
      yield* consistent
      assert.deepStrictEqual(yield* found("yokewordtwo"), ["drill.yoke"])
      assert.deepStrictEqual(yield* found("quartzwordtwo"), ["drill.quartz"])
      assert.deepStrictEqual(yield* found("quartzwordone"), [])
    }),
  )

  it.effect("pages the hot feed by score, and filters by kind and language", () =>
    Effect.gen(function* () {
      const env = yield* TestEnv
      const author = yield* signIn("Feed Writer")
      const anon = yield* anonymous()
      const make = (slug: string, kind: "learn" | "situation", lang: "en" | "th") =>
        Effect.gen(function* () {
          const published = yield* author.client.lessons.publish({
            params: { slug },
            payload: jsonBytes({ ...tinyLesson(lang, slug), kind }),
          })
          yield* author.client.lessons.update({
            params: { id: published.lesson.id },
            payload: { visibility: "public", category_id: "math", tags: ["feeds"] },
          })
          return published.lesson.id
        })
      const a = yield* make("feed-a", "learn", "en")
      const b = yield* make("feed-b", "situation", "th")
      const c = yield* make("feed-c", "learn", "en")
      const d = yield* make("feed-d", "situation", "en")
      // Scores as the cron would leave them, on the lesson and the tag copy.
      const scores: ReadonlyArray<readonly [LessonId, number]> = [
        [a, 0.75],
        [b, 2.5],
        [c, 0.125],
        [d, 1.5],
      ]
      yield* Effect.promise(() =>
        env.db.batch(
          scores.flatMap(([id, score]) => [
            env.db.prepare("update lesson set hot_score = ? where id = ?").bind(score, id),
            env.db.prepare("update lesson_tag set hot_score = ? where lesson_id = ?").bind(score, id),
          ]),
        ),
      )

      const page1 = yield* anon.feeds.hot({ query: { limit: 3 } })
      assert.deepStrictEqual(ids(page1), [b, d, a])
      assert.isNotNull(page1.next_cursor)
      const page2 = yield* anon.feeds.hot(
        page1.next_cursor === null ? { query: {} } : { query: { limit: 3, cursor: page1.next_cursor } },
      )
      assert.deepStrictEqual(ids(page2), [c])
      assert.isNull(page2.next_cursor)
      assert.deepStrictEqual(ids(yield* anon.feeds.hot({ query: { kind: "situation" } })), [b, d])
      assert.deepStrictEqual(
        ids(yield* anon.feeds.tag({ params: { slug: "feeds" }, query: { sort: "hot" } })),
        [b, d, a, c],
      )
      const tagPage = yield* anon.feeds.tag({ params: { slug: "feeds" }, query: { sort: "hot", limit: 2 } })
      assert.deepStrictEqual(ids(tagPage), [b, d])
      assert.isNotNull(tagPage.next_cursor)
      if (tagPage.next_cursor !== null) {
        const next = yield* anon.feeds.tag({
          params: { slug: "feeds" },
          query: { sort: "hot", limit: 2, cursor: tagPage.next_cursor },
        })
        assert.deepStrictEqual(ids(next), [a, c])
      }

      // Newest first, by kind or by language.
      assert.deepStrictEqual(ids(yield* anon.feeds.new({ query: { kind: "learn" } })), [c, a])
      assert.deepStrictEqual(ids(yield* anon.feeds.new({ query: { lang: "th" } })), [b])
      const english = yield* anon.feeds.new({ query: { lang: "en", limit: 2 } })
      assert.deepStrictEqual(ids(english), [d, c])
      assert.isNotNull(english.next_cursor)
      if (english.next_cursor !== null) {
        const rest = yield* anon.feeds.new({ query: { lang: "en", limit: 2, cursor: english.next_cursor } })
        assert.deepStrictEqual(ids(rest), [a])
      }
      // A translation joins its language's feed, shown in that language.
      yield* author.client.lessons.publish({
        params: { slug: "feed-a" },
        payload: jsonBytes({ ...tinyLesson("th", "feed-a"), title: "บทเรียนเอ" }),
      })
      const thai = yield* anon.feeds.new({ query: { lang: "th" } })
      assert.deepStrictEqual(ids(thai), [b, a])
      assert.strictEqual(thai.items[1]?.title, "บทเรียนเอ")
      // Hidden lessons leave every feed.
      yield* author.client.lessons.update({ params: { id: b }, payload: { visibility: "unlisted" } })
      assert.deepStrictEqual(ids(yield* anon.feeds.new({ query: { lang: "th" } })), [a])
      assert.deepStrictEqual(ids(yield* anon.feeds.hot({ query: { kind: "situation" } })), [d])

      // No index covers kind and language together: refused, not scanned.
      const both = yield* anon.feeds.new({ query: { kind: "learn", lang: "en" } }).pipe(Effect.flip)
      assert.strictEqual(both._tag, "UnsupportedFilter")
    }),
  )
})
