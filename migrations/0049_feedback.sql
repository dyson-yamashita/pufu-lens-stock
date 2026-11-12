CREATE TABLE usability_feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  screen TEXT NOT NULL DEFAULT 'pufu-editor',
  language TEXT NOT NULL DEFAULT 'ja',
  category TEXT NOT NULL,
  detail TEXT NOT NULL,
  reasons TEXT NOT NULL,
  conversation TEXT NOT NULL DEFAULT '[]',
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  reproduction_steps TEXT NOT NULL DEFAULT '',
  expected_behavior TEXT NOT NULL DEFAULT '',
  actual_behavior TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  review_status TEXT NOT NULL DEFAULT 'unreviewed',
  hold_reason TEXT,
  round INTEGER NOT NULL DEFAULT 0,
  follow_up TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, request_id)
);
CREATE INDEX usability_feedback_user_created ON usability_feedback(user_id, created_at);
CREATE INDEX usability_feedback_created ON usability_feedback(created_at);
CREATE INDEX usability_feedback_review ON usability_feedback(review_status, created_at);
-- Anonymous rolling quota receipts are deliberately independent of account/report deletion.
CREATE TABLE feedback_global_usage (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE INDEX feedback_global_usage_created ON feedback_global_usage(created_at);
