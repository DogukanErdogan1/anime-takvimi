CREATE TABLE anilist_connections (
 user_id TEXT PRIMARY KEY REFERENCES members(id), anilist_id INTEGER NOT NULL UNIQUE,
 display_name TEXT NOT NULL, token_cipher TEXT NOT NULL, expires_at INTEGER NOT NULL,
 generation TEXT NOT NULL, connected_at INTEGER NOT NULL,
 rate_reset INTEGER NOT NULL DEFAULT 0, rate_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE anilist_oauth_states (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES members(id),
 session_hash TEXT NOT NULL REFERENCES auth_sessions(token_hash) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0 CHECK(used IN(0,1))
);
CREATE INDEX anilist_states_user ON anilist_oauth_states(user_id,expires_at);
CREATE TABLE anilist_sync_plans (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES anilist_connections(user_id) ON DELETE CASCADE,
 generation TEXT NOT NULL, direction TEXT NOT NULL CHECK(direction IN('import','export')),
 library_revision TEXT NOT NULL, data_json TEXT NOT NULL CHECK(json_valid(data_json)),
 expires_at INTEGER NOT NULL, locked_until INTEGER NOT NULL DEFAULT 0, lease TEXT
);
CREATE INDEX anilist_plans_user ON anilist_sync_plans(user_id,expires_at);
