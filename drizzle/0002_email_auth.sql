CREATE TABLE `auth_accounts` (
  `user_id` text PRIMARY KEY NOT NULL REFERENCES `members`(`id`),
  `email` text NOT NULL UNIQUE,
  `password_hash` text NOT NULL,
  `password_salt` text NOT NULL,
  `password_algorithm` text NOT NULL,
  `password_parameters` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `auth_email_check` CHECK(length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  CONSTRAINT `auth_password_parameters_check` CHECK(json_valid(password_parameters)),
  CONSTRAINT `auth_password_salt_check` CHECK(length(password_salt) = 64)
);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `auth_accounts`(`user_id`),
  `created_at` integer NOT NULL,
  `expires_at` integer NOT NULL,
  CONSTRAINT `auth_token_hash_check` CHECK(length(token_hash) = 64),
  CONSTRAINT `auth_session_expiry_check` CHECK(expires_at > created_at)
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`user_id`);
--> statement-breakpoint
CREATE INDEX `auth_sessions_expiry_idx` ON `auth_sessions` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `auth_rate_limits` (
  `bucket_key` text PRIMARY KEY NOT NULL,
  `reset_at` integer NOT NULL,
  `attempts` integer NOT NULL,
  CONSTRAINT `auth_rate_attempts_check` CHECK(attempts >= 1)
);
--> statement-breakpoint
CREATE INDEX `auth_rate_expiry_idx` ON `auth_rate_limits` (`reset_at`);
