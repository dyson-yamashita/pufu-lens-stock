-- 複数関連を独立させ、生成元の削除で共有データを失わない。局面とコメントを保持する。
CREATE TABLE multi_pufu_scores_backup AS SELECT * FROM pufu_scores;
-- statement-breakpoint
CREATE TABLE multi_pufu_phases_backup AS SELECT * FROM pufu_phases;
-- statement-breakpoint
DROP TRIGGER comments_question_deleted;
-- statement-breakpoint
DROP TRIGGER comments_pufu_deleted;
-- statement-breakpoint
DROP TRIGGER comments_phase_deleted;
-- statement-breakpoint
DROP TRIGGER move_question_pufus;
-- statement-breakpoint
DROP TRIGGER move_stock_questions;
-- statement-breakpoint
DROP TRIGGER infer_pufu_project;
-- statement-breakpoint
DROP TRIGGER validate_pufu_project_insert;
-- statement-breakpoint
DROP TRIGGER validate_pufu_project_update;
-- statement-breakpoint
DROP TRIGGER infer_question_project;
-- statement-breakpoint
DROP TRIGGER validate_question_project_insert;
-- statement-breakpoint
DROP TRIGGER validate_question_project_update;
-- statement-breakpoint
CREATE TABLE questions_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT '' REFERENCES projects(id) ON DELETE CASCADE,
  stock_id TEXT REFERENCES stocks(id) ON DELETE SET NULL,
  text TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'generating', 'ready', 'failed')),
  generation INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  source TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'user')),
  is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
  note TEXT NOT NULL DEFAULT '',
  request_json TEXT
);
-- statement-breakpoint
INSERT INTO questions_new SELECT questions.*,NULL FROM questions;
-- statement-breakpoint
DROP TABLE questions;
-- statement-breakpoint
ALTER TABLE questions_new RENAME TO questions;
-- statement-breakpoint
CREATE TABLE pufu_scores_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT REFERENCES questions(id) ON DELETE SET NULL,
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
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  current_phase INTEGER NOT NULL DEFAULT 1 CHECK (current_phase > 0),
  project_id TEXT NOT NULL DEFAULT '' REFERENCES projects(id) ON DELETE CASCADE,
  request_json TEXT
);
-- statement-breakpoint
INSERT INTO pufu_scores_new SELECT * FROM multi_pufu_scores_backup;
-- statement-breakpoint
DROP TABLE pufu_scores;
-- statement-breakpoint
ALTER TABLE pufu_scores_new RENAME TO pufu_scores;
-- statement-breakpoint
INSERT INTO pufu_phases SELECT * FROM multi_pufu_phases_backup;
-- statement-breakpoint
DROP TABLE multi_pufu_scores_backup;
-- statement-breakpoint
DROP TABLE multi_pufu_phases_backup;
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
-- statement-breakpoint
CREATE INDEX pufu_question ON pufu_scores(question_id, created_at DESC, id DESC);
-- statement-breakpoint
CREATE INDEX pufu_project ON pufu_scores(project_id, created_at DESC, id DESC);
-- statement-breakpoint
-- 移行後も、旧Workerや既存の問い経由の作成で所属を補完する。
CREATE TRIGGER infer_pufu_project AFTER INSERT ON pufu_scores
WHEN NEW.project_id='' AND NEW.question_id IS NOT NULL
BEGIN
  UPDATE pufu_scores SET project_id=(SELECT project_id FROM questions WHERE id=NEW.question_id) WHERE id=NEW.id;
END;
-- statement-breakpoint
CREATE TRIGGER validate_pufu_project_insert BEFORE INSERT ON pufu_scores
WHEN (NEW.project_id='' AND NEW.question_id IS NULL)
OR (NEW.project_id<>'' AND NOT EXISTS (SELECT 1 FROM projects WHERE id=NEW.project_id AND user_id=NEW.user_id))
OR (NEW.question_id IS NOT NULL AND NEW.project_id<>'' AND NOT EXISTS (SELECT 1 FROM questions WHERE id=NEW.question_id AND project_id=NEW.project_id))
BEGIN
  SELECT RAISE(ABORT,'pufu_project_mismatch');
END;
-- statement-breakpoint
CREATE TRIGGER validate_pufu_project_update BEFORE UPDATE OF project_id,question_id,user_id ON pufu_scores
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id=NEW.project_id AND user_id=NEW.user_id)
OR (NEW.question_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM questions WHERE id=NEW.question_id AND project_id=NEW.project_id))
BEGIN
  SELECT RAISE(ABORT,'pufu_project_mismatch');
END;
-- statement-breakpoint
CREATE TRIGGER move_question_pufus AFTER UPDATE OF project_id ON questions
BEGIN
  UPDATE pufu_scores SET project_id=NEW.project_id WHERE question_id=NEW.id;
END;
-- statement-breakpoint
CREATE TRIGGER comments_pufu_deleted AFTER DELETE ON pufu_scores BEGIN
  DELETE FROM comments WHERE target_type='pufu' AND target_id=OLD.id;
END;
-- statement-breakpoint
CREATE TRIGGER comments_phase_deleted AFTER DELETE ON pufu_phases BEGIN
  DELETE FROM comments WHERE target_type='pufu' AND target_id=OLD.pufu_id AND phase=OLD.number;
END;
-- statement-breakpoint
CREATE TRIGGER comments_question_deleted AFTER DELETE ON questions BEGIN DELETE FROM comments WHERE target_type='question' AND target_id=OLD.id; END;
-- statement-breakpoint
CREATE TABLE question_stocks (
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  stock_id TEXT NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  PRIMARY KEY (question_id,stock_id)
);
-- statement-breakpoint
CREATE INDEX question_stocks_reverse ON question_stocks(stock_id,question_id);
-- statement-breakpoint
CREATE TRIGGER validate_question_stocks_insert BEFORE INSERT ON question_stocks
WHEN NOT EXISTS (SELECT 1 FROM questions l JOIN stocks r ON r.project_id=l.project_id WHERE l.id=NEW.question_id AND r.id=NEW.stock_id)
BEGIN SELECT RAISE(ABORT,'relation_project_mismatch'); END;
-- statement-breakpoint
CREATE TRIGGER validate_question_stocks_update BEFORE UPDATE ON question_stocks
WHEN NOT EXISTS (SELECT 1 FROM questions l JOIN stocks r ON r.project_id=l.project_id WHERE l.id=NEW.question_id AND r.id=NEW.stock_id)
BEGIN SELECT RAISE(ABORT,'relation_project_mismatch'); END;
-- statement-breakpoint
CREATE TABLE pufu_questions (
  pufu_id TEXT NOT NULL REFERENCES pufu_scores(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  PRIMARY KEY (pufu_id,question_id)
);
-- statement-breakpoint
CREATE INDEX pufu_questions_reverse ON pufu_questions(question_id,pufu_id);
-- statement-breakpoint
CREATE TRIGGER validate_pufu_questions_insert BEFORE INSERT ON pufu_questions
WHEN NOT EXISTS (SELECT 1 FROM pufu_scores l JOIN questions r ON r.project_id=l.project_id WHERE l.id=NEW.pufu_id AND r.id=NEW.question_id)
BEGIN SELECT RAISE(ABORT,'relation_project_mismatch'); END;
-- statement-breakpoint
CREATE TRIGGER validate_pufu_questions_update BEFORE UPDATE ON pufu_questions
WHEN NOT EXISTS (SELECT 1 FROM pufu_scores l JOIN questions r ON r.project_id=l.project_id WHERE l.id=NEW.pufu_id AND r.id=NEW.question_id)
BEGIN SELECT RAISE(ABORT,'relation_project_mismatch'); END;
-- statement-breakpoint
CREATE TABLE pufu_stocks (
  pufu_id TEXT NOT NULL REFERENCES pufu_scores(id) ON DELETE CASCADE,
  stock_id TEXT NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  PRIMARY KEY (pufu_id,stock_id)
);
-- statement-breakpoint
CREATE INDEX pufu_stocks_reverse ON pufu_stocks(stock_id,pufu_id);
-- statement-breakpoint
CREATE TRIGGER validate_pufu_stocks_insert BEFORE INSERT ON pufu_stocks
WHEN NOT EXISTS (SELECT 1 FROM pufu_scores l JOIN stocks r ON r.project_id=l.project_id WHERE l.id=NEW.pufu_id AND r.id=NEW.stock_id)
BEGIN SELECT RAISE(ABORT,'relation_project_mismatch'); END;
-- statement-breakpoint
CREATE TRIGGER validate_pufu_stocks_update BEFORE UPDATE ON pufu_stocks
WHEN NOT EXISTS (SELECT 1 FROM pufu_scores l JOIN stocks r ON r.project_id=l.project_id WHERE l.id=NEW.pufu_id AND r.id=NEW.stock_id)
BEGIN SELECT RAISE(ABORT,'relation_project_mismatch'); END;
-- statement-breakpoint
INSERT INTO question_stocks SELECT id,stock_id FROM questions WHERE stock_id IS NOT NULL;
-- statement-breakpoint
UPDATE questions SET request_json=json_object('project_id',project_id,'stock_ids',CASE WHEN stock_id IS NULL THEN json('[]') ELSE json_array(stock_id) END,'text',text,'note',note) WHERE source='user';
-- statement-breakpoint
INSERT INTO pufu_questions SELECT id,question_id FROM pufu_scores WHERE question_id IS NOT NULL;
-- statement-breakpoint
INSERT INTO pufu_stocks SELECT pf.id,q.stock_id FROM pufu_scores pf JOIN questions q ON q.id=pf.question_id WHERE q.stock_id IS NOT NULL;
-- statement-breakpoint
CREATE TRIGGER seed_question_stock AFTER INSERT ON questions
BEGIN
  UPDATE questions SET project_id=(SELECT project_id FROM stocks WHERE id=NEW.stock_id) WHERE id=NEW.id AND project_id='' AND NEW.stock_id IS NOT NULL;
  INSERT INTO question_stocks SELECT NEW.id,value FROM json_each(COALESCE(json_extract(NEW.request_json,'$.stock_ids'),CASE WHEN NEW.stock_id IS NULL THEN '[]' ELSE json_array(NEW.stock_id) END));
END;
-- statement-breakpoint
CREATE TRIGGER seed_pufu_question AFTER INSERT ON pufu_scores
BEGIN
  UPDATE pufu_scores SET project_id=(SELECT project_id FROM questions WHERE id=NEW.question_id) WHERE id=NEW.id AND project_id='' AND NEW.question_id IS NOT NULL;
  INSERT INTO pufu_questions SELECT NEW.id,value FROM json_each(COALESCE(json_extract(NEW.request_json,'$.question_ids'),CASE WHEN NEW.question_id IS NULL THEN '[]' ELSE json_array(NEW.question_id) END));
  INSERT INTO pufu_stocks SELECT NEW.id,value FROM json_each(COALESCE(json_extract(NEW.request_json,'$.stock_ids'),(SELECT json_group_array(stock_id) FROM question_stocks WHERE question_id=NEW.question_id)));
END;
-- statement-breakpoint
CREATE TRIGGER guard_linked_question_move BEFORE UPDATE OF project_id ON questions
WHEN OLD.project_id<>NEW.project_id AND (
 EXISTS(SELECT 1 FROM question_stocks qs JOIN stocks s ON s.id=qs.stock_id WHERE qs.question_id=OLD.id AND s.project_id<>NEW.project_id)
 OR EXISTS(SELECT 1 FROM pufu_questions pq JOIN pufu_scores pf ON pf.id=pq.pufu_id WHERE pq.question_id=OLD.id AND (pf.question_id IS NOT OLD.id OR EXISTS(SELECT 1 FROM pufu_questions other WHERE other.pufu_id=pf.id AND other.question_id<>OLD.id) OR EXISTS(SELECT 1 FROM pufu_stocks ps JOIN stocks s ON s.id=ps.stock_id WHERE ps.pufu_id=pf.id AND s.project_id<>NEW.project_id)))
)
BEGIN SELECT RAISE(ABORT,'linked_project_move'); END;
-- statement-breakpoint
CREATE TRIGGER guard_linked_stock_move BEFORE UPDATE OF project_id ON stocks
WHEN OLD.project_id<>NEW.project_id AND (
 EXISTS(SELECT 1 FROM question_stocks qs JOIN questions q ON q.id=qs.question_id WHERE qs.stock_id=OLD.id AND (q.stock_id IS NOT OLD.id OR EXISTS(SELECT 1 FROM question_stocks other WHERE other.question_id=q.id AND other.stock_id<>OLD.id)))
 OR EXISTS(SELECT 1 FROM pufu_stocks ps JOIN pufu_scores pf ON pf.id=ps.pufu_id WHERE ps.stock_id=OLD.id AND NOT EXISTS(SELECT 1 FROM questions q WHERE q.id=pf.question_id AND q.stock_id=OLD.id))
)
BEGIN SELECT RAISE(ABORT,'linked_project_move'); END;
-- statement-breakpoint
CREATE TRIGGER guard_linked_pufu_move BEFORE UPDATE OF project_id ON pufu_scores
WHEN OLD.project_id<>NEW.project_id AND (
 EXISTS(SELECT 1 FROM pufu_questions pq JOIN questions q ON q.id=pq.question_id WHERE pq.pufu_id=OLD.id AND q.project_id<>NEW.project_id)
 OR EXISTS(SELECT 1 FROM pufu_stocks ps JOIN stocks s ON s.id=ps.stock_id WHERE ps.pufu_id=OLD.id AND s.project_id<>NEW.project_id)
)
BEGIN SELECT RAISE(ABORT,'linked_project_move'); END;
-- statement-breakpoint
-- 旧クライアントによる単一ID更新も関連へ反映する。複数APIで設定済みの関連は保持する。
CREATE TRIGGER sync_legacy_pufu_question AFTER UPDATE OF question_id ON pufu_scores
WHEN NEW.question_id IS NOT OLD.question_id AND (
 (NEW.question_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pufu_questions WHERE pufu_id=NEW.id AND question_id=NEW.question_id))
 OR (NEW.question_id IS NULL AND EXISTS(SELECT 1 FROM questions WHERE id=OLD.question_id))
)
BEGIN
 DELETE FROM pufu_questions WHERE pufu_id=NEW.id;
 INSERT INTO pufu_questions SELECT NEW.id,NEW.question_id WHERE NEW.question_id IS NOT NULL;
END;
-- statement-breakpoint
CREATE TRIGGER finish_detached_question_generation BEFORE DELETE ON stocks
BEGIN
 UPDATE questions SET status='failed',error='作成元のストックが削除されたため、問い・気づきの生成を終了しました。',generation=generation+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE stock_id=OLD.id AND source='ai' AND status IN ('queued','generating');
 UPDATE processing_jobs SET status='done',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE user_id=OLD.user_id AND kind='question' AND target_id=OLD.id AND status<>'done';
END;
