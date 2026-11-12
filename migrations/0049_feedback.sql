CREATE TABLE usability_feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  category TEXT NOT NULL,
  detail TEXT NOT NULL,
  reasons TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  issue_number INTEGER,
  issue_repository TEXT,
  issue_title TEXT,
  issue_summary TEXT,
  hold_reason TEXT,
  round INTEGER NOT NULL DEFAULT 0,
  follow_up TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, request_id)
);
CREATE INDEX usability_feedback_user_created ON usability_feedback(user_id, created_at);
CREATE INDEX usability_feedback_created ON usability_feedback(created_at);
CREATE INDEX usability_feedback_repository ON usability_feedback(issue_repository, status);
CREATE TABLE feedback_issue_lock (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
