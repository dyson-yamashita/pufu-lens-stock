CREATE TABLE memory_versions (
  memory_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  content_key TEXT NOT NULL UNIQUE,
  article_count INTEGER NOT NULL,
  model TEXT NOT NULL,
  language TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  PRIMARY KEY (memory_id, revision)
);
CREATE INDEX memory_versions_owner ON memory_versions(user_id, memory_id, revision DESC);
CREATE TABLE memory_history_cleanup (
  prefix TEXT PRIMARY KEY,
  generation TEXT NOT NULL DEFAULT (lower(hex(randomblob(16))))
);

-- No FK: an interrupted external write must remain discoverable after owner deletion.
CREATE TABLE memory_history_writes (
  id TEXT PRIMARY KEY,
  content_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  project_id TEXT,
  last_checked_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX memory_history_writes_cleanup ON memory_history_writes(last_checked_at, id);
