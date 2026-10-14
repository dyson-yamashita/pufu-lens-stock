CREATE TABLE processing_jobs_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('article', 'project_memory', 'user_memory', 'cleanup', 'question')),
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

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  stock_id TEXT NOT NULL UNIQUE REFERENCES stocks(id) ON DELETE CASCADE,
  text TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'generating', 'ready', 'failed')),
  generation INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX questions_status ON questions(status);

INSERT INTO questions (id, stock_id, status, error, created_at)
SELECT 'question-' || s.id, s.id,
  CASE WHEN a.status = 'failed' THEN 'failed' ELSE 'queued' END,
  CASE WHEN a.status = 'failed' THEN '記事の取得・要約が完了していません。記事の再取得をお試しください。' ELSE NULL END,
  s.created_at
FROM stocks s JOIN articles a ON a.id = s.article_id;

INSERT INTO processing_jobs (id, user_id, kind, target_id, revision)
SELECT 'q-' || q.stock_id || '-' || q.generation, s.user_id, 'question', s.id, q.generation
FROM questions q JOIN stocks s ON s.id = q.stock_id JOIN articles a ON a.id = s.article_id
WHERE q.status = 'queued' AND a.status = 'ready';
