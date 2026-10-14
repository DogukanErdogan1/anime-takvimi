CREATE TABLE `admin_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`target_id` text NOT NULL,
	`action` text NOT NULL,
	`metadata_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "audit_action_check" CHECK("admin_audit"."action" = 'member_status'),
	CONSTRAINT "audit_metadata_check" CHECK(json_valid("admin_audit"."metadata_json") AND length("admin_audit"."metadata_json") <= 512)
);
--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `admin_audit` (`created_at`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT "settings_key_check" CHECK("app_settings"."key" = 'admin_owner')
);
--> statement-breakpoint
CREATE TABLE `member_libraries` (
	`user_id` text PRIMARY KEY NOT NULL,
	`library_json` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "library_json_check" CHECK(json_valid("member_libraries"."library_json") AND length("member_libraries"."library_json") <= 1048576)
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "members_role_check" CHECK("members"."role" IN ('admin','member')),
	CONSTRAINT "members_status_check" CHECK("members"."status" IN ('active','suspended')),
	CONSTRAINT "members_name_check" CHECK(length("members"."display_name") BETWEEN 2 AND 40)
);
--> statement-breakpoint
CREATE INDEX `members_created_idx` ON `members` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `members_email_idx` ON `members` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_single_admin` ON `members` (`role`) WHERE "members"."role" = 'admin';