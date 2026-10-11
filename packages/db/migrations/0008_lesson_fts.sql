-- Lesson search (GET /api/lessons/search). Like concept_fts (0002): a regular FTS5 table, derived
-- from lesson_lang.search (title and summary, Thai split into words before it is stored), so it can
-- be rebuilt with one statement after an export (packages/db/README.md). It holds a row only for
-- each language of a public, not deleted lesson; the batch that changes visibility or deletes a
-- lesson removes its rows by rowid (lesson_lang.fts_rowid).
CREATE VIRTUAL TABLE `lesson_fts` USING fts5(
  `lesson_id` UNINDEXED,
  `lang` UNINDEXED,
  `search`,
  tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
-- Every existing lesson_lang row gets a fixed FTS rowid (its own rowid is unique).
UPDATE `lesson_lang` SET `fts_rowid` = rowid;
--> statement-breakpoint
-- The per-language feed copies (lesson_lang_feed_idx).
UPDATE `lesson_lang` SET
  `is_public` = (SELECT CASE WHEN l.`visibility` = 'public' AND l.`deleted_at` IS NULL THEN 1 ELSE 0 END
    FROM `lesson` l WHERE l.`id` = `lesson_lang`.`lesson_id`),
  `published_at` = (SELECT l.`published_at` FROM `lesson` l WHERE l.`id` = `lesson_lang`.`lesson_id`);
-- `search` stays null: SQL cannot split Thai into words. The hot-score cron fills it (and the
-- lesson_fts row) a few rows at a time (LessonSearch.backfill).
