-- Backfill for 0004_feed_indexes. Runs once over the existing rows.
-- lesson_category: each public lesson under its category and every ancestor (dotted-path prefix).
INSERT INTO `lesson_category` (`lesson_id`, `category_id`, `published_at`)
SELECT l.`id`, c.`id`, l.`published_at`
FROM `lesson` l
JOIN `category` c ON l.`category_id` = c.`id`
  OR substr(l.`category_id`, 1, length(c.`id`) + 1) = c.`id` || '.'
WHERE l.`visibility` = 'public' AND l.`deleted_at` IS NULL AND l.`published_at` IS NOT NULL;
--> statement-breakpoint
-- concept_fts: give every concept_lang row a fixed FTS rowid (its own rowid is unique), then
-- rebuild the FTS table with those rowids so later updates delete by rowid.
UPDATE `concept_lang` SET `fts_rowid` = rowid;
--> statement-breakpoint
DELETE FROM `concept_fts`;
--> statement-breakpoint
INSERT INTO `concept_fts` (rowid, `concept_id`, `lang`, `search`)
SELECT `fts_rowid`, `concept_id`, `lang`, `search` FROM `concept_lang`;
