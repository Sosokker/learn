CREATE TABLE `byok_key` (
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`last4` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `byok_key_pk` PRIMARY KEY(`user_id`, `provider`),
	CONSTRAINT `fk_byok_key_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `generation_job` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`prompt` text NOT NULL,
	`lang` text NOT NULL,
	`model` text NOT NULL,
	`billing` text NOT NULL,
	`day` text NOT NULL,
	`lesson_id` text,
	`lesson_slug` text,
	`version_id` text,
	`error` text,
	`turns` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`cost_micros` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	CONSTRAINT `fk_generation_job_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_generation_job_lesson_id_lesson_id_fk` FOREIGN KEY (`lesson_id`) REFERENCES `lesson`(`id`),
	CONSTRAINT "generation_job_status_check" CHECK("status" in ('queued', 'running', 'succeeded', 'failed', 'canceled')),
	CONSTRAINT "generation_job_billing_check" CHECK("billing" in ('platform', 'byok')),
	CONSTRAINT "generation_job_lang_check" CHECK("lang" in ('en', 'th'))
);
--> statement-breakpoint
CREATE TABLE `generation_usage` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`jobs` integer DEFAULT 0 NOT NULL,
	`cost_micros` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `generation_usage_pk` PRIMARY KEY(`user_id`, `day`),
	CONSTRAINT `fk_generation_usage_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `generation_job_user_idx` ON `generation_job` (`user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `generation_job_active_idx` ON `generation_job` (`user_id`) WHERE status in ('queued', 'running');