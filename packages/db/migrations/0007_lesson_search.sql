ALTER TABLE `lesson_lang` ADD `search` text;--> statement-breakpoint
ALTER TABLE `lesson_lang` ADD `fts_rowid` integer;--> statement-breakpoint
ALTER TABLE `lesson_lang` ADD `is_public` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `lesson_lang` ADD `published_at` integer;--> statement-breakpoint
CREATE INDEX `lesson_kind_hot_idx` ON `lesson` (`kind`,`hot_score`,`id`) WHERE visibility = 'public' and deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX `lesson_lang_fts_rowid_unique` ON `lesson_lang` (`fts_rowid`);--> statement-breakpoint
CREATE INDEX `lesson_lang_feed_idx` ON `lesson_lang` (`lang`,`published_at`,`lesson_id`) WHERE is_public = 1;--> statement-breakpoint
CREATE INDEX `lesson_lang_search_todo_idx` ON `lesson_lang` (`lesson_id`) WHERE search is null;