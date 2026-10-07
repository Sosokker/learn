CREATE TABLE `account` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` text,
	`refresh_token_expires_at` text,
	`scope` text,
	`password` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_account_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`id` text PRIMARY KEY,
	`key` text NOT NULL UNIQUE,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY,
	`token` text NOT NULL UNIQUE,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_session_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`email` text NOT NULL UNIQUE,
	`email_verified` integer DEFAULT 0 NOT NULL,
	`image` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `api_token` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`hash` text NOT NULL UNIQUE,
	`name` text NOT NULL,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	CONSTRAINT `fk_api_token_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `bookmark` (
	`user_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `bookmark_pk` PRIMARY KEY(`user_id`, `lesson_id`),
	CONSTRAINT `fk_bookmark_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_bookmark_lesson_id_lesson_id_fk` FOREIGN KEY (`lesson_id`) REFERENCES `lesson`(`id`)
);
--> statement-breakpoint
CREATE TABLE `category` (
	`id` text PRIMARY KEY,
	`parent_id` text,
	`name_en` text NOT NULL,
	`name_th` text NOT NULL,
	`sort` integer NOT NULL,
	CONSTRAINT `fk_category_parent_id_category_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `category`(`id`)
);
--> statement-breakpoint
CREATE TABLE `comment` (
	`id` text PRIMARY KEY,
	`lesson_id` text NOT NULL,
	`user_id` text NOT NULL,
	`version_id` text NOT NULL,
	`anchor` text,
	`parent_id` text,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_comment_lesson_id_lesson_id_fk` FOREIGN KEY (`lesson_id`) REFERENCES `lesson`(`id`),
	CONSTRAINT `fk_comment_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`),
	CONSTRAINT `fk_comment_version_id_lesson_version_id_fk` FOREIGN KEY (`version_id`) REFERENCES `lesson_version`(`id`),
	CONSTRAINT `fk_comment_parent_id_comment_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `comment`(`id`)
);
--> statement-breakpoint
CREATE TABLE `concept` (
	`id` text PRIMARY KEY,
	`slug` text NOT NULL UNIQUE,
	`owner_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_concept_owner_id_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE TABLE `concept_lang` (
	`concept_id` text NOT NULL,
	`lang` text NOT NULL,
	`version_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`aliases` text NOT NULL,
	`search` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `concept_lang_pk` PRIMARY KEY(`concept_id`, `lang`),
	CONSTRAINT `fk_concept_lang_concept_id_concept_id_fk` FOREIGN KEY (`concept_id`) REFERENCES `concept`(`id`),
	CONSTRAINT `fk_concept_lang_version_id_concept_version_id_fk` FOREIGN KEY (`version_id`) REFERENCES `concept_version`(`id`),
	CONSTRAINT "concept_lang_lang_check" CHECK("lang" in ('en', 'th'))
);
--> statement-breakpoint
CREATE TABLE `concept_need` (
	`concept_id` text NOT NULL,
	`need_id` text NOT NULL,
	CONSTRAINT `concept_need_pk` PRIMARY KEY(`concept_id`, `need_id`),
	CONSTRAINT `fk_concept_need_concept_id_concept_id_fk` FOREIGN KEY (`concept_id`) REFERENCES `concept`(`id`),
	CONSTRAINT `fk_concept_need_need_id_concept_id_fk` FOREIGN KEY (`need_id`) REFERENCES `concept`(`id`)
);
--> statement-breakpoint
CREATE TABLE `concept_version` (
	`id` text PRIMARY KEY,
	`concept_id` text NOT NULL,
	`lang` text NOT NULL,
	`n` integer NOT NULL,
	`body_hash` text NOT NULL,
	`body_bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_concept_version_concept_id_concept_id_fk` FOREIGN KEY (`concept_id`) REFERENCES `concept`(`id`),
	CONSTRAINT `concept_version_concept_lang_n_unique` UNIQUE(`concept_id`,`lang`,`n`),
	CONSTRAINT "concept_version_lang_check" CHECK("lang" in ('en', 'th'))
);
--> statement-breakpoint
CREATE TABLE `lesson` (
	`id` text PRIMARY KEY,
	`owner_id` text NOT NULL,
	`slug` text NOT NULL,
	`kind` text NOT NULL,
	`default_lang` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`category_id` text,
	`visibility` text DEFAULT 'private' NOT NULL,
	`forked_from_version_id` text,
	`problem_hash` text,
	`like_count` integer DEFAULT 0 NOT NULL,
	`fork_count` integer DEFAULT 0 NOT NULL,
	`comment_count` integer DEFAULT 0 NOT NULL,
	`hot_score` real DEFAULT 0 NOT NULL,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_lesson_owner_id_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`),
	CONSTRAINT `fk_lesson_category_id_category_id_fk` FOREIGN KEY (`category_id`) REFERENCES `category`(`id`),
	CONSTRAINT `fk_lesson_forked_from_version_id_lesson_version_id_fk` FOREIGN KEY (`forked_from_version_id`) REFERENCES `lesson_version`(`id`),
	CONSTRAINT `lesson_owner_slug_unique` UNIQUE(`owner_id`,`slug`),
	CONSTRAINT "lesson_kind_check" CHECK("kind" in ('solve', 'learn', 'situation', 'code', 'proof', 'guide')),
	CONSTRAINT "lesson_default_lang_check" CHECK("default_lang" in ('en', 'th')),
	CONSTRAINT "lesson_visibility_check" CHECK("visibility" in ('private', 'unlisted', 'public'))
);
--> statement-breakpoint
CREATE TABLE `lesson_lang` (
	`lesson_id` text NOT NULL,
	`lang` text NOT NULL,
	`version_id` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `lesson_lang_pk` PRIMARY KEY(`lesson_id`, `lang`),
	CONSTRAINT `fk_lesson_lang_lesson_id_lesson_id_fk` FOREIGN KEY (`lesson_id`) REFERENCES `lesson`(`id`),
	CONSTRAINT `fk_lesson_lang_version_id_lesson_version_id_fk` FOREIGN KEY (`version_id`) REFERENCES `lesson_version`(`id`),
	CONSTRAINT "lesson_lang_lang_check" CHECK("lang" in ('en', 'th'))
);
--> statement-breakpoint
CREATE TABLE `lesson_like` (
	`user_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `lesson_like_pk` PRIMARY KEY(`user_id`, `lesson_id`),
	CONSTRAINT `fk_lesson_like_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_lesson_like_lesson_id_lesson_id_fk` FOREIGN KEY (`lesson_id`) REFERENCES `lesson`(`id`)
);
--> statement-breakpoint
CREATE TABLE `lesson_tag` (
	`lesson_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`is_public` integer DEFAULT 0 NOT NULL,
	`published_at` integer,
	`hot_score` real DEFAULT 0 NOT NULL,
	CONSTRAINT `lesson_tag_pk` PRIMARY KEY(`lesson_id`, `tag_id`),
	CONSTRAINT `fk_lesson_tag_lesson_id_lesson_id_fk` FOREIGN KEY (`lesson_id`) REFERENCES `lesson`(`id`),
	CONSTRAINT `fk_lesson_tag_tag_id_tag_id_fk` FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`)
);
--> statement-breakpoint
CREATE TABLE `lesson_version` (
	`id` text PRIMARY KEY,
	`lesson_id` text NOT NULL,
	`lang` text NOT NULL,
	`n` integer NOT NULL,
	`body_hash` text NOT NULL,
	`body_bytes` integer NOT NULL,
	`schema` integer NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_lesson_version_lesson_id_lesson_id_fk` FOREIGN KEY (`lesson_id`) REFERENCES `lesson`(`id`),
	CONSTRAINT `lesson_version_lesson_lang_n_unique` UNIQUE(`lesson_id`,`lang`,`n`),
	CONSTRAINT "lesson_version_lang_check" CHECK("lang" in ('en', 'th'))
);
--> statement-breakpoint
CREATE TABLE `lesson_version_concept` (
	`lesson_version_id` text NOT NULL,
	`card_id` text NOT NULL,
	`concept_version_id` text NOT NULL,
	CONSTRAINT `lesson_version_concept_pk` PRIMARY KEY(`lesson_version_id`, `card_id`),
	CONSTRAINT `fk_lesson_version_concept_lesson_version_id_lesson_version_id_fk` FOREIGN KEY (`lesson_version_id`) REFERENCES `lesson_version`(`id`),
	CONSTRAINT `fk_lesson_version_concept_concept_version_id_concept_version_id_fk` FOREIGN KEY (`concept_version_id`) REFERENCES `concept_version`(`id`)
);
--> statement-breakpoint
CREATE TABLE `profile` (
	`user_id` text PRIMARY KEY,
	`handle` text NOT NULL UNIQUE,
	`bio` text,
	`lesson_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_profile_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `progress` (
	`user_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`version_id` text NOT NULL,
	`state` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `progress_pk` PRIMARY KEY(`user_id`, `lesson_id`),
	CONSTRAINT `fk_progress_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_progress_lesson_id_lesson_id_fk` FOREIGN KEY (`lesson_id`) REFERENCES `lesson`(`id`),
	CONSTRAINT `fk_progress_version_id_lesson_version_id_fk` FOREIGN KEY (`version_id`) REFERENCES `lesson_version`(`id`)
);
--> statement-breakpoint
CREATE TABLE `report` (
	`id` text PRIMARY KEY,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`reporter_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_report_reporter_id_user_id_fk` FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`),
	CONSTRAINT "report_status_check" CHECK("status" in ('open', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE `tag` (
	`id` text PRIMARY KEY,
	`slug` text NOT NULL UNIQUE,
	`name` text NOT NULL,
	`lesson_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE INDEX `api_token_user_idx` ON `api_token` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `category_parent_idx` ON `category` (`parent_id`,`sort`);--> statement-breakpoint
CREATE INDEX `comment_lesson_idx` ON `comment` (`lesson_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `concept_need_need_idx` ON `concept_need` (`need_id`);--> statement-breakpoint
CREATE INDEX `concept_version_hash_idx` ON `concept_version` (`body_hash`);--> statement-breakpoint
CREATE INDEX `lesson_new_idx` ON `lesson` (`published_at`,`id`) WHERE visibility = 'public' and deleted_at is null;--> statement-breakpoint
CREATE INDEX `lesson_hot_idx` ON `lesson` (`hot_score`,`id`) WHERE visibility = 'public' and deleted_at is null;--> statement-breakpoint
CREATE INDEX `lesson_cat_idx` ON `lesson` (`category_id`,`published_at`,`id`) WHERE visibility = 'public' and deleted_at is null;--> statement-breakpoint
CREATE INDEX `lesson_kind_idx` ON `lesson` (`kind`,`published_at`,`id`) WHERE visibility = 'public' and deleted_at is null;--> statement-breakpoint
CREATE INDEX `lesson_owner_idx` ON `lesson` (`owner_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `lesson_problem_idx` ON `lesson` (`problem_hash`) WHERE problem_hash is not null;--> statement-breakpoint
CREATE INDEX `lesson_tag_feed_idx` ON `lesson_tag` (`tag_id`,`published_at`,`lesson_id`) WHERE is_public = 1;--> statement-breakpoint
CREATE INDEX `lesson_tag_hot_idx` ON `lesson_tag` (`tag_id`,`hot_score`,`lesson_id`) WHERE is_public = 1;--> statement-breakpoint
CREATE INDEX `lesson_version_hash_idx` ON `lesson_version` (`body_hash`);--> statement-breakpoint
CREATE INDEX `lesson_version_concept_concept_idx` ON `lesson_version_concept` (`concept_version_id`);--> statement-breakpoint
CREATE INDEX `report_open_idx` ON `report` (`created_at`) WHERE status = 'open';