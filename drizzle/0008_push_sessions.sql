ALTER TABLE push_subscriptions ADD COLUMN device_hash TEXT;
ALTER TABLE push_subscriptions ADD COLUMN binding_id TEXT;
ALTER TABLE push_subscriptions ADD COLUMN session_hash TEXT REFERENCES auth_sessions(token_hash) ON DELETE CASCADE;
CREATE UNIQUE INDEX push_device_unique ON push_subscriptions(device_hash);
CREATE INDEX push_session_idx ON push_subscriptions(session_hash);
ALTER TABLE push_deliveries ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1 CHECK(attempts BETWEEN 1 AND 3);
