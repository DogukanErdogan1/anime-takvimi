CREATE TABLE watch_clubs (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES members(id),
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 80), created_at TEXT NOT NULL
);
CREATE INDEX watch_clubs_owner ON watch_clubs(owner_id);
CREATE TABLE watch_club_members (
 club_id TEXT NOT NULL REFERENCES watch_clubs(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES members(id), joined_at TEXT NOT NULL,
 PRIMARY KEY(club_id,user_id)
);
CREATE INDEX watch_club_user ON watch_club_members(user_id);
CREATE TABLE watch_club_entries (
 club_id TEXT NOT NULL REFERENCES watch_clubs(id) ON DELETE CASCADE,
 anime_id INTEGER NOT NULL CHECK(anime_id BETWEEN 1 AND 2147483647),
 anime_json TEXT NOT NULL CHECK(json_valid(anime_json) AND length(anime_json)<=4096),
 added_by TEXT NOT NULL REFERENCES members(id), created_at TEXT NOT NULL,
 PRIMARY KEY(club_id,anime_id)
);
CREATE TABLE watch_club_votes (
 club_id TEXT NOT NULL, user_id TEXT NOT NULL, anime_id INTEGER NOT NULL,
 PRIMARY KEY(club_id,user_id),
 FOREIGN KEY(club_id,user_id) REFERENCES watch_club_members(club_id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(club_id,anime_id) REFERENCES watch_club_entries(club_id,anime_id) ON DELETE CASCADE
);
CREATE TABLE watch_club_invites (
 club_id TEXT PRIMARY KEY REFERENCES watch_clubs(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64), expires_at INTEGER NOT NULL
);
