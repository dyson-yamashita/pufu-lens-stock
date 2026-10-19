-- ユーザー削除後も後処理を再試行するため、usersへの外部キーは持たない。
CREATE TABLE account_deletions (
  user_id TEXT PRIMARY KEY,
  generation TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_attempt_at TEXT
);

CREATE TABLE account_deletion_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES account_deletions(user_id) ON DELETE CASCADE,
  kind TEXT NOT NULL
);
CREATE INDEX account_deletion_jobs_owner ON account_deletion_jobs(user_id);
