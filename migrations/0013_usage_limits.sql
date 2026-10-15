CREATE TABLE stock_usage (
  stock_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- statement-breakpoint
INSERT INTO stock_usage (stock_id,user_id,created_at) SELECT id,user_id,created_at FROM stocks;
-- statement-breakpoint
CREATE INDEX stock_usage_window ON stock_usage(user_id,created_at);
-- statement-breakpoint
CREATE TRIGGER enforce_stock_quota BEFORE INSERT ON stocks
WHEN NOT EXISTS (SELECT 1 FROM stocks WHERE project_id=NEW.project_id AND article_id=NEW.article_id)
AND (SELECT COUNT(*) FROM stock_usage WHERE user_id=NEW.user_id AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')) >= 200
BEGIN
  SELECT RAISE(ABORT,'stock_quota');
END;
-- statement-breakpoint
CREATE TRIGGER record_stock_usage AFTER INSERT ON stocks
BEGIN
  INSERT INTO stock_usage (stock_id,user_id,created_at) VALUES (NEW.id,NEW.user_id,NEW.created_at);
END;
-- statement-breakpoint
CREATE TABLE ai_operations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- statement-breakpoint
CREATE INDEX ai_operations_window ON ai_operations(user_id,kind,created_at);
-- statement-breakpoint
CREATE TABLE quota_assertions (ok INTEGER CONSTRAINT ai_quota CHECK(ok=1));
-- statement-breakpoint
CREATE TABLE memory_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- statement-breakpoint
CREATE TABLE ai_calls (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('running','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  retry_blocked INTEGER NOT NULL DEFAULT 0,
  result_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- statement-breakpoint
CREATE INDEX ai_calls_active ON ai_calls(user_id,status);
-- statement-breakpoint
CREATE TABLE ai_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- statement-breakpoint
CREATE INDEX ai_attempts_window ON ai_attempts(user_id,created_at);
-- statement-breakpoint
CREATE TABLE ai_deferrals (
  job_id TEXT PRIMARY KEY,
  retry_at TEXT NOT NULL
);
