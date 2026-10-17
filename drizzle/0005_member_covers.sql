CREATE TABLE `member_covers` (
	`user_id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cover_type_check" CHECK("member_covers"."content_type" IN ('image/png','image/jpeg','image/webp')),
	CONSTRAINT "cover_key_check" CHECK(length("member_covers"."object_key") = 107 AND substr("member_covers"."object_key",1,6) = 'cover/')
);
