CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('stock', 'question', 'pufu')),
  target_id TEXT NOT NULL,
  phase INTEGER,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_kind TEXT NOT NULL DEFAULT 'user' CHECK (author_kind IN ('user', 'agent')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((target_type = 'pufu' AND phase IS NOT NULL AND phase > 0) OR (target_type != 'pufu' AND phase IS NULL))
);
-- statement-breakpoint
CREATE INDEX comments_target ON comments(target_type, target_id, phase, created_at, id);
-- statement-breakpoint
-- 対象の外部キー連鎖削除でも、対応するコメントを同じトランザクションで削除する。
CREATE TRIGGER comments_stock_deleted AFTER DELETE ON stocks BEGIN
  DELETE FROM comments WHERE target_type = 'stock' AND target_id = OLD.id;
END;
-- statement-breakpoint
CREATE TRIGGER comments_question_deleted AFTER DELETE ON questions BEGIN
  DELETE FROM comments WHERE target_type = 'question' AND target_id = OLD.id;
END;
-- statement-breakpoint
CREATE TRIGGER comments_pufu_deleted AFTER DELETE ON pufu_scores BEGIN
  DELETE FROM comments WHERE target_type = 'pufu' AND target_id = OLD.id;
END;
-- statement-breakpoint
CREATE TRIGGER comments_phase_deleted AFTER DELETE ON pufu_phases BEGIN
  DELETE FROM comments WHERE target_type = 'pufu' AND target_id = OLD.pufu_id AND phase = OLD.number;
END;
