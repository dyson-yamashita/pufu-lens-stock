CREATE TABLE pufu_image_links (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  pufu_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  phase INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  content_key TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  ready INTEGER NOT NULL DEFAULT 0 CHECK (ready IN (0, 1))
);
CREATE INDEX pufu_image_links_expiry ON pufu_image_links(expires_at);
CREATE INDEX pufu_image_links_user_expiry ON pufu_image_links(user_id, expires_at);
