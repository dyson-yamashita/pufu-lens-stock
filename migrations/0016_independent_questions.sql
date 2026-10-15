-- 親テーブルの再作成によるCASCADEから、既存のプ譜と局面を保護する。
CREATE TABLE independent_questions_pufu_backup AS SELECT * FROM pufu_scores;
-- statement-breakpoint
CREATE TABLE independent_questions_phases_backup AS SELECT * FROM pufu_phases;
-- statement-breakpoint
CREATE TABLE questions_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT '' REFERENCES projects(id) ON DELETE CASCADE,
  stock_id TEXT REFERENCES stocks(id) ON DELETE CASCADE,
  text TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'generating', 'ready', 'failed')),
  generation INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  source TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'user')),
  is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
  CHECK (stock_id IS NOT NULL OR source = 'user')
);
-- statement-breakpoint
INSERT INTO questions_new (id,project_id,stock_id,text,status,generation,error,model,created_at,updated_at,source,is_favorite)
SELECT q.id,s.project_id,q.stock_id,q.text,q.status,q.generation,q.error,q.model,q.created_at,q.updated_at,q.source,q.is_favorite
FROM questions q JOIN stocks s ON s.id=q.stock_id;
-- statement-breakpoint
DROP TABLE questions;
-- statement-breakpoint
ALTER TABLE questions_new RENAME TO questions;
-- statement-breakpoint
INSERT INTO pufu_scores SELECT * FROM independent_questions_pufu_backup;
-- statement-breakpoint
INSERT INTO pufu_phases SELECT * FROM independent_questions_phases_backup;
-- statement-breakpoint
DROP TABLE independent_questions_phases_backup;
-- statement-breakpoint
DROP TABLE independent_questions_pufu_backup;
-- statement-breakpoint
CREATE UNIQUE INDEX questions_one_ai_per_stock ON questions(stock_id) WHERE source = 'ai';
-- statement-breakpoint
CREATE INDEX questions_stock ON questions(stock_id, created_at DESC);
-- statement-breakpoint
CREATE INDEX questions_status ON questions(status);
-- statement-breakpoint
CREATE INDEX questions_source ON questions(source, created_at DESC);
-- statement-breakpoint
CREATE INDEX questions_favorites ON questions(created_at DESC, id DESC) WHERE is_favorite = 1;
-- statement-breakpoint
CREATE INDEX questions_project ON questions(project_id, created_at DESC, id DESC);
-- statement-breakpoint
-- DB移行後、旧Workerによるstock_idだけのINSERTも所属を補完する。
CREATE TRIGGER infer_question_project AFTER INSERT ON questions
WHEN NEW.project_id = '' AND NEW.stock_id IS NOT NULL
BEGIN
  UPDATE questions SET project_id = (SELECT project_id FROM stocks WHERE id=NEW.stock_id) WHERE id=NEW.id;
END;
-- statement-breakpoint
CREATE TRIGGER validate_question_project_insert BEFORE INSERT ON questions
WHEN (NEW.project_id = '' AND NEW.stock_id IS NULL)
OR (NEW.stock_id IS NOT NULL AND NEW.project_id <> '' AND NOT EXISTS (SELECT 1 FROM stocks WHERE id=NEW.stock_id AND project_id=NEW.project_id))
BEGIN
  SELECT RAISE(ABORT,'question_project_mismatch');
END;
-- statement-breakpoint
CREATE TRIGGER validate_question_project_update BEFORE UPDATE OF project_id,stock_id ON questions
WHEN NEW.stock_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM stocks WHERE id=NEW.stock_id AND project_id=NEW.project_id)
BEGIN
  SELECT RAISE(ABORT,'question_project_mismatch');
END;
-- statement-breakpoint
CREATE TRIGGER move_stock_questions AFTER UPDATE OF project_id ON stocks
BEGIN
  UPDATE questions SET project_id=NEW.project_id WHERE stock_id=NEW.id;
END;
