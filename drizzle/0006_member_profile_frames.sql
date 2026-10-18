CREATE TABLE `member_profile_frames` (
	`user_id` text PRIMARY KEY NOT NULL,
	`frame_id` text DEFAULT 'none' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "profile_frame_id_check" CHECK("member_profile_frames"."frame_id" IN ('none','platin','yorunge','editor','kirik-halo','murekkep','panel','kristal','krom-akis','defne','krizantem','koi','yildiz-muhru'))
);
