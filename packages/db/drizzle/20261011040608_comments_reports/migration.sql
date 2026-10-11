ALTER TABLE `comment` ADD `reply_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `comment` ADD `edited_at` integer;--> statement-breakpoint
ALTER TABLE `comment` ADD `hidden_at` integer;--> statement-breakpoint
ALTER TABLE `comment` ADD `hidden_by` text;--> statement-breakpoint
ALTER TABLE `report` ADD `note` text;--> statement-breakpoint
ALTER TABLE `report` ADD `resolved_at` integer;--> statement-breakpoint
ALTER TABLE `report` ADD `resolved_by` text;--> statement-breakpoint
DROP INDEX IF EXISTS `comment_lesson_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `report_open_idx`;--> statement-breakpoint
CREATE INDEX `comment_thread_idx` ON `comment` (`lesson_id`,`created_at`,`id`) WHERE parent_id is null;--> statement-breakpoint
CREATE INDEX `comment_anchor_idx` ON `comment` (`lesson_id`,`anchor`,`created_at`,`id`) WHERE parent_id is null;--> statement-breakpoint
CREATE INDEX `comment_reply_idx` ON `comment` (`parent_id`,`created_at`,`id`) WHERE parent_id is not null;--> statement-breakpoint
CREATE INDEX `report_queue_idx` ON `report` (`created_at`,`id`) WHERE status = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX `report_open_unique` ON `report` (`reporter_id`,`target_type`,`target_id`) WHERE status = 'open';--> statement-breakpoint
CREATE INDEX `report_target_idx` ON `report` (`target_type`,`target_id`) WHERE status = 'open';