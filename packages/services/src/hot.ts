import { Db, lesson } from "@app/db"
import { and, eq, gt, isNull, sql } from "drizzle-orm"
import { Clock, Effect } from "effect"

const day = 86_400_000

// (likes + 2·forks + comments + 1) / (age_hours + 2)^1.5, for lessons published in the last 14
// days; older scores stay frozen. Computed here rather than in SQL (pow() is optional in SQLite),
// and only rows whose score moved are written.
export const recomputeHotScores = Effect.fn("recomputeHotScores")(function* () {
  const { drizzle: db, run } = yield* Db
  const now = yield* Clock.currentTimeMillis
  const rows = yield* run(() =>
    db
      .select({
        id: lesson.id,
        likes: lesson.likeCount,
        forks: lesson.forkCount,
        comments: lesson.commentCount,
        publishedAt: lesson.publishedAt,
        hot: lesson.hotScore,
      })
      .from(lesson)
      .where(
        and(
          eq(lesson.visibility, "public"),
          isNull(lesson.deletedAt),
          gt(lesson.publishedAt, now - 14 * day),
        ),
      ),
  )
  const changed = rows.flatMap((r) => {
    const hours = Math.max(0, (now - (r.publishedAt ?? now)) / 3_600_000)
    const score = (r.likes + 2 * r.forks + r.comments + 1) / (hours + 2) ** 1.5
    return Math.abs(score - r.hot) > 1e-9 ? [{ id: r.id, score }] : []
  })
  for (let i = 0; i < changed.length; i += 50) {
    const chunk = changed.slice(i, i + 50)
    yield* run(() =>
      db.batch(
        chunk.flatMap((c) => [
          db.update(lesson).set({ hotScore: c.score }).where(eq(lesson.id, c.id)),
          db.run(sql`update lesson_tag set hot_score = ${c.score} where lesson_id = ${c.id}`),
        ]) as [ReturnType<typeof db.run>, ...Array<ReturnType<typeof db.run>>],
      ),
    )
  }
  return changed.length
})
