ALTER TABLE anime_reviews ADD COLUMN episode INTEGER
  CHECK (episode IS NULL OR (typeof(episode) = 'integer' AND episode BETWEEN 1 AND 9999 AND spoiler = 1));
