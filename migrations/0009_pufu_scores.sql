CREATE TABLE processing_jobs_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('article', 'project_memory', 'user_memory', 'cleanup', 'question', 'pufu')),
  target_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispatched', 'running', 'done', 'failed')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO processing_jobs_new SELECT * FROM processing_jobs;
DROP TABLE processing_jobs;
ALTER TABLE processing_jobs_new RENAME TO processing_jobs;
CREATE INDEX jobs_pending ON processing_jobs(status, created_at);

CREATE TABLE pufu_scores (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  task TEXT NOT NULL,
  input_json TEXT NOT NULL,
  generated_json TEXT,
  score_json TEXT,
  editor_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'generating', 'ready', 'failed')),
  generation INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX pufu_question ON pufu_scores(question_id, created_at DESC, id DESC);
