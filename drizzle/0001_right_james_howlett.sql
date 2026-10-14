CREATE TABLE `member_avatars` (
	`user_id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "avatar_type_check" CHECK("member_avatars"."content_type" IN ('image/png','image/jpeg','image/webp')),
	CONSTRAINT "avatar_key_check" CHECK(length("member_avatars"."object_key") = 108 AND substr("member_avatars"."object_key",1,7) = 'avatar/')
);
