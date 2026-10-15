CREATE TABLE `anime_banners` (
  `mal_id` integer PRIMARY KEY NOT NULL CHECK(mal_id BETWEEN 1 AND 2147483647),
  `object_key` text NOT NULL CHECK(length(object_key) BETWEEN 45 AND 54 AND substr(object_key,1,7)='banner/'),
  `content_type` text NOT NULL CHECK(content_type IN ('image/png','image/jpeg','image/webp')),
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_by` text NOT NULL REFERENCES members(id)
);
