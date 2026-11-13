CREATE TABLE review_reports (
 id TEXT PRIMARY KEY NOT NULL,
 review_id TEXT NOT NULL REFERENCES anime_reviews(id), reporter_id TEXT NOT NULL REFERENCES members(id),
 reason TEXT NOT NULL CHECK(reason IN ('spoiler','abuse','spam','other')),
 detail TEXT NOT NULL DEFAULT '' CHECK(length(detail)<=500),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','dismissed','removed')),
 created_at TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT REFERENCES members(id),
 UNIQUE(review_id,reporter_id)
);
CREATE INDEX review_reports_queue ON review_reports(status,created_at);
CREATE TABLE push_subscriptions (
 endpoint_hash TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES members(id),
 subscription_json TEXT NOT NULL CHECK(json_valid(subscription_json) AND length(subscription_json)<=4096),
 created_at TEXT NOT NULL
);
CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);
CREATE TABLE push_deliveries (
 endpoint_hash TEXT NOT NULL REFERENCES push_subscriptions(endpoint_hash) ON DELETE CASCADE,
 occurrence TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('sending','sent','failed')),
 claimed_at INTEGER NOT NULL, PRIMARY KEY(endpoint_hash,occurrence)
);
