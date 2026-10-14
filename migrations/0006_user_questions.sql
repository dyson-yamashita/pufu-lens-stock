CREATE TABLE questions_new (
  id TEXT PRIMARY KEY,
  stock_id TEXT NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  text TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'generating', 'ready', 'failed')),
  generation INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  source TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'user'))
);
INSERT INTO questions_new (id, stock_id, text, status, generation, error, model, created_at, updated_at, source)
SELECT id, stock_id, text, status, generation, error, model, created_at, updated_at, source FROM questions;
DROP TABLE questions;
ALTER TABLE questions_new RENAME TO questions;
CREATE UNIQUE INDEX questions_one_ai_per_stock ON questions(stock_id) WHERE source = 'ai';
CREATE INDEX questions_stock ON questions(stock_id, created_at DESC);
CREATE INDEX questions_status ON questions(status);
CREATE INDEX questions_source ON questions(source, created_at DESC);
