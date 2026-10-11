import { defaultPageLimit, type LessonHits, LessonId } from "@app/api"
import { Database, raw } from "@app/db"
import type { LessonLang } from "@app/domain"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { LessonRow, lessonColumnsWith, toLessonPage } from "./rows.ts"
import { ftsQuery, searchText } from "./search.ts"

// The text lesson_fts indexes for one language of a lesson. Tags are left out on purpose: they
// have their own exact feed, and keeping them out makes the indexed text a function of lesson_lang
// alone, so a re-tag writes no FTS rows and the index rebuilds with one statement.
export const lessonSearchText = (title: string, summary: string): string => searchText(`${title}\n${summary}`)

// Brings one lesson's derived rows in line with the lesson row, as the last statements of the
// batch that changed it (publish, settings, delete): the per-language feed copies, and its
// lesson_fts rows, which exist only while the lesson is public and not deleted. FTS rows are found
// by rowid (lesson_lang.fts_rowid); lesson_fts's other columns are UNINDEXED, so a lookup by
// lesson_id would scan the whole FTS table. At most two rows each (en, th). A row without an
// fts_rowid (written by a Worker from before migration 0007) is left out: FTS5 would give it an
// automatic rowid that nothing points at. The backfill gives it one first.
export const syncLessonLangs = (lessonId: LessonId) => [
  raw(sql`update lesson_lang set
      is_public = (select case when l.visibility = 'public' and l.deleted_at is null then 1 else 0 end
        from lesson l where l.id = lesson_lang.lesson_id),
      published_at = (select l.published_at from lesson l where l.id = lesson_lang.lesson_id)
    where lesson_id = ${lessonId}`),
  raw(
    sql`delete from lesson_fts where rowid in (select fts_rowid from lesson_lang where lesson_id = ${lessonId})`,
  ),
  raw(sql`insert into lesson_fts (rowid, lesson_id, lang, search)
    select ll.fts_rowid, ll.lesson_id, ll.lang, ll.search from lesson_lang ll
    where ll.lesson_id = ${lessonId} and ll.is_public = 1 and ll.search is not null and ll.fts_rowid is not null`),
]

// The FTS rowid for a new lesson_lang row: past both the highest one handed out and the highest
// row in lesson_fts, so it cannot collide with a row inserted some other way (an automatic
// rowid). Both are one read: the unique fts_rowid index, and FTS5's rowid order (`order by rowid
// desc limit 1` stops at the first row; `max(rowid)` on a virtual table would scan it).
export const nextLessonFtsRowid = sql`(select max(
    coalesce((select max(fts_rowid) from lesson_lang), 0),
    coalesce((select rowid from lesson_fts order by rowid desc limit 1), 0)
  ) + 1)`

// Lessons per backfill batch: an update per language (at most two) plus syncLessonLangs' three
// statements, so at most 125 statements a batch. The cron's limit (worker.ts) keeps a whole run to
// a few batches, well under D1's per-invocation query limit.
const backfillChunk = 25

const TodoRow = Schema.Struct({
  lesson_id: LessonId,
  lang: Schema.String,
  title: Schema.String,
  summary: Schema.String,
})

export class LessonSearch extends Context.Service<
  LessonSearch,
  {
    readonly search: (options: {
      readonly q: string
      readonly lang?: LessonLang | undefined
      readonly limit?: number | undefined
    }) => Effect.Effect<LessonHits>
    // Fills lesson_lang.search (and the FTS row) for up to `limit` rows from before migration 0007,
    // or written by the previous Worker while a deploy was rolling out: those may also lack an
    // fts_rowid, and get one here. Returns how many rows it filled. Run by the cron until nothing
    // is left.
    readonly backfill: (limit: number) => Effect.Effect<number>
  }
>()("@app/services/LessonSearch") {
  static readonly layer = Layer.effect(
    LessonSearch,
    Effect.gen(function* () {
      const db = yield* Database

      // One page, no cursor. FTS5 must score every match to order by rank, so a second page would
      // cost as much as the first and a bm25 cursor shifts as the corpus changes; better words
      // narrow the search instead. `limit` is at most 50 (PageLimit).
      const search = Effect.fn("LessonSearch.search")(function* (options: {
        readonly q: string
        readonly lang?: LessonLang | undefined
        readonly limit?: number | undefined
      }) {
        const match = ftsQuery(options.q)
        if (match === undefined) return { items: [] }
        const limit = Math.min(Math.max(options.limit ?? defaultPageLimit, 1), 50)
        // A lesson can match in both languages: read twice the limit, keep each lesson's best.
        // The public check repeats what lesson_fts already guarantees; it is a primary-key lookup.
        const rows = yield* db
          .query(
            raw(sql`select ${lessonColumnsWith({ text: sql`ll` })}
              from lesson_fts f
              join lesson l on l.id = f.lesson_id
              join lesson_lang ll on ll.lesson_id = f.lesson_id and ll.lang = f.lang
              join profile p on p.user_id = l.owner_id
              where lesson_fts match ${match} ${options.lang === undefined ? sql`` : sql`and f.lang = ${options.lang}`}
                and l.visibility = 'public' and l.deleted_at is null
              order by f.rank limit ${limit * 2}`),
            LessonRow,
          )
          .pipe(Effect.orDie)
        const best = rows.filter((row, index) => rows.findIndex((other) => other.id === row.id) === index)
        const page = yield* toLessonPage(db, best.slice(0, limit), limit, () => 0).pipe(Effect.orDie)
        return { items: page.items }
      })

      const backfill = Effect.fn("LessonSearch.backfill")(function* (limit: number) {
        const rows = yield* db
          .query(
            raw(
              sql`select lesson_id, lang, title, summary from lesson_lang where search is null limit ${limit}`,
            ),
            TodoRow,
          )
          .pipe(Effect.orDie)
        // Both languages of a lesson go in the same chunk, so syncLessonLangs sees them filled.
        const ids = [...new Set(rows.map((row) => row.lesson_id))]
        const chunks = Array.from({ length: Math.ceil(ids.length / backfillChunk) }, (_, index) =>
          ids.slice(index * backfillChunk, (index + 1) * backfillChunk),
        )
        yield* Effect.forEach(
          chunks,
          (chunk) =>
            db
              .batch([
                ...rows
                  .filter((row) => chunk.includes(row.lesson_id))
                  .map((row) =>
                    raw(sql`update lesson_lang set search = ${lessonSearchText(row.title, row.summary)},
                        fts_rowid = coalesce(fts_rowid, ${nextLessonFtsRowid})
                      where lesson_id = ${row.lesson_id} and lang = ${row.lang}`),
                  ),
                ...chunk.flatMap(syncLessonLangs),
              ])
              .pipe(Effect.orDie),
          { discard: true },
        )
        return rows.length
      })

      return LessonSearch.of({ search, backfill })
    }),
  )
}
