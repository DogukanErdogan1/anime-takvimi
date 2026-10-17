CREATE TABLE `anime_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`anime_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`spoiler` integer DEFAULT 0 NOT NULL,
	`score` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`hidden` integer DEFAULT 0 NOT NULL,
	`hidden_by` text,
	`hidden_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hidden_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_anime_check" CHECK("anime_reviews"."anime_id" BETWEEN 1 AND 9999999999),
	CONSTRAINT "review_body_check" CHECK(length(trim("anime_reviews"."body")) BETWEEN 1 AND 2000),
	CONSTRAINT "review_spoiler_check" CHECK("anime_reviews"."spoiler" IN (0,1)),
	CONSTRAINT "review_score_check" CHECK("anime_reviews"."score" IS NULL OR "anime_reviews"."score" BETWEEN 1 AND 10),
	CONSTRAINT "review_hidden_check" CHECK("anime_reviews"."hidden" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_author_anime_idx` ON `anime_reviews` (`anime_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `reviews_visible_idx` ON `anime_reviews` (`anime_id`,`hidden`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `community_rate_limits` (
	`bucket_key` text PRIMARY KEY NOT NULL,
	`reset_at` integer NOT NULL,
	`attempts` integer NOT NULL,
	CONSTRAINT "community_rate_attempts_check" CHECK("community_rate_limits"."attempts" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE `member_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`is_public` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "profile_bio_check" CHECK(length("member_profiles"."bio") <= 500),
	CONSTRAINT "profile_public_check" CHECK("member_profiles"."is_public" IN (0,1))
);
