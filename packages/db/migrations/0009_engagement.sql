ALTER TABLE `progress` ADD `done` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `bookmark_user_idx` ON `bookmark` (`user_id`,`created_at`,`lesson_id`);--> statement-breakpoint
CREATE INDEX `bookmark_lesson_idx` ON `bookmark` (`lesson_id`);--> statement-breakpoint
CREATE INDEX `lesson_like_lesson_idx` ON `lesson_like` (`lesson_id`);--> statement-breakpoint
CREATE INDEX `progress_user_idx` ON `progress` (`user_id`,`updated_at`,`lesson_id`) WHERE done = 0;--> statement-breakpoint
CREATE INDEX `progress_lesson_idx` ON `progress` (`lesson_id`);