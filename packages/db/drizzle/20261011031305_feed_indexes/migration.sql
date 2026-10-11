CREATE TABLE `lesson_category` (
	`lesson_id` text NOT NULL,
	`category_id` text NOT NULL,
	`published_at` integer NOT NULL,
	CONSTRAINT `lesson_category_pk` PRIMARY KEY(`lesson_id`, `category_id`),
	CONSTRAINT `fk_lesson_category_lesson_id_lesson_id_fk` FOREIGN KEY (`lesson_id`) REFERENCES `lesson`(`id`),
	CONSTRAINT `fk_lesson_category_category_id_category_id_fk` FOREIGN KEY (`category_id`) REFERENCES `category`(`id`)
);
--> statement-breakpoint
ALTER TABLE `concept_lang` ADD `fts_rowid` integer;--> statement-breakpoint
DROP INDEX IF EXISTS `lesson_cat_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `concept_lang_fts_rowid_unique` ON `concept_lang` (`fts_rowid`);--> statement-breakpoint
CREATE INDEX `lesson_category_feed_idx` ON `lesson_category` (`category_id`,`published_at`,`lesson_id`);--> statement-breakpoint
CREATE INDEX `lesson_tag_recent_idx` ON `lesson_tag` (`published_at`) WHERE is_public = 1;