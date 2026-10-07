import { Database, raw } from "@app/db"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"

// Lessons first made public within this window get a fresh hot score; older scores stay frozen.
const window = 14 * 24 * 60 * 60 * 1000

// (likes + 2·forks + comments + 1) / (age_hours + 2)^1.5, rounded so an unchanged score is not
// rewritten (D1 bills rows written).
const score = (now: number) =>
  sql`round((like_count + 2 * fork_count + comment_count + 1) / pow((${now} - published_at) / 3600000.0 + 2, 1.5), 6)`

export class HotScore extends Context.Service<
  HotScore,
  { readonly recompute: (now: number) => Effect.Effect<void> }
>()("@app/services/HotScore") {
  static readonly layer = Layer.effect(
    HotScore,
    Effect.gen(function* () {
      const db = yield* Database
      return HotScore.of({
        // The cron (every 30 minutes). lesson_tag keeps a copy for the tag feeds' hot index.
        recompute: Effect.fn("HotScore.recompute")(function* (now: number) {
          const since = now - window
          yield* db
            .batch([
              raw(sql`update lesson set hot_score = ${score(now)}
                where visibility = 'public' and deleted_at is null and published_at > ${since}
                  and hot_score <> ${score(now)}`),
              raw(sql`update lesson_tag set hot_score = (select l.hot_score from lesson l where l.id = lesson_tag.lesson_id)
                where is_public = 1 and published_at > ${since}
                  and hot_score <> (select l.hot_score from lesson l where l.id = lesson_tag.lesson_id)`),
            ])
            .pipe(Effect.orDie)
        }),
      })
    }),
  )
}
