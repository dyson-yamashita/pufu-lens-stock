-- プ譜をプロジェクトへ直接所属させる。親の再作成による局面・コメントの削除を防ぐ。
CREATE TABLE independent_pufus_phases_backup AS SELECT * FROM pufu_phases;
-- statement-breakpoint
DROP TRIGGER comments_pufu_deleted;
-- statement-breakpoint
DROP TRIGGER comments_phase_deleted;
-- statement-breakpoint
CREATE TABLE pufu_scores_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT REFERENCES questions(id) ON DELETE CASCADE,
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
INSERT INTO pufu_scores_new
SELECT pf.*,q.project_id,NULL FROM pufu_scores pf JOIN questions q ON q.id=pf.question_id;
-- statement-breakpoint
DROP TABLE pufu_scores;
-- statement-breakpoint
ALTER TABLE pufu_scores_new RENAME TO pufu_scores;
-- statement-breakpoint
INSERT INTO pufu_phases SELECT * FROM independent_pufus_phases_backup;
-- statement-breakpoint
DROP TABLE independent_pufus_phases_backup;
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
CREATE TABLE pufu_image_links_new (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT,
  pufu_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  phase INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  content_key TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  ready INTEGER NOT NULL DEFAULT 0 CHECK (ready IN (0, 1))
);
-- statement-breakpoint
INSERT INTO pufu_image_links_new SELECT * FROM pufu_image_links;
-- statement-breakpoint
DROP TABLE pufu_image_links;
-- statement-breakpoint
ALTER TABLE pufu_image_links_new RENAME TO pufu_image_links;
-- statement-breakpoint
CREATE INDEX pufu_image_links_expiry ON pufu_image_links(expires_at);
-- statement-breakpoint
CREATE INDEX pufu_image_links_user_expiry ON pufu_image_links(user_id, expires_at);
