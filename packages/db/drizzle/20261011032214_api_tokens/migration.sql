ALTER TABLE `api_token` ADD `prefix` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `api_token_active_idx` ON `api_token` (`user_id`,`created_at`,`id`) WHERE revoked_at is null;