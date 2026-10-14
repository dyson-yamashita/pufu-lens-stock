CREATE TABLE api_tokens_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  project_id TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
);

INSERT INTO api_tokens_new (
  id, user_id, name, token_hash, prefix, project_id,
  expires_at, revoked_at, last_used_at, created_at
)
SELECT
  id, user_id, name, token_hash, prefix, project_id,
  expires_at, revoked_at, last_used_at, created_at
FROM api_tokens;

DROP TABLE api_tokens;
ALTER TABLE api_tokens_new RENAME TO api_tokens;
