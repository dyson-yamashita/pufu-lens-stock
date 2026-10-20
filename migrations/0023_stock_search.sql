-- 削除後もVectorizeの削除要求を残すため、users/stocksへの外部キーを持たない。
CREATE TABLE stock_search_entries (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  stock_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  current INTEGER NOT NULL DEFAULT 1 CHECK(current IN (0,1)),
  ready INTEGER NOT NULL DEFAULT 0 CHECK(ready IN (0,1)),
  touched INTEGER NOT NULL DEFAULT 0 CHECK(touched IN (0,1)),
  write_pending INTEGER NOT NULL DEFAULT 0 CHECK(write_pending IN (0,1)),
  lease_until TEXT,
  next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- statement-breakpoint
CREATE UNIQUE INDEX stock_search_current ON stock_search_entries(stock_id) WHERE current=1;
-- statement-breakpoint
CREATE INDEX stock_search_pending ON stock_search_entries(current,ready,next_attempt_at);
-- statement-breakpoint
CREATE INDEX stock_search_owner ON stock_search_entries(user_id,stock_id);
-- statement-breakpoint
INSERT INTO stock_search_entries(stock_id,user_id) SELECT id,user_id FROM stocks;
-- statement-breakpoint
CREATE TRIGGER stock_search_insert AFTER INSERT ON stocks
BEGIN
  INSERT INTO stock_search_entries(stock_id,user_id) VALUES(NEW.id,NEW.user_id);
END;
-- statement-breakpoint
CREATE TRIGGER stock_search_update AFTER UPDATE OF title,note,project_id ON stocks
WHEN NEW.title IS NOT OLD.title OR NEW.note IS NOT OLD.note OR NEW.project_id IS NOT OLD.project_id
BEGIN
  UPDATE stock_search_entries SET current=0,next_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE stock_id=NEW.id AND current=1;
  INSERT INTO stock_search_entries(stock_id,user_id) VALUES(NEW.id,NEW.user_id);
END;
-- statement-breakpoint
CREATE TRIGGER stock_search_delete AFTER DELETE ON stocks
BEGIN
  UPDATE stock_search_entries SET current=0,next_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE stock_id=OLD.id;
END;
-- statement-breakpoint
CREATE TRIGGER stock_search_article_update AFTER UPDATE OF title,summary_json,status ON articles
WHEN NEW.title IS NOT OLD.title OR NEW.summary_json IS NOT OLD.summary_json OR NEW.status IS NOT OLD.status
BEGIN
  UPDATE stock_search_entries SET current=0,next_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE current=1 AND stock_id IN (SELECT id FROM stocks WHERE article_id=NEW.id);
  INSERT INTO stock_search_entries(stock_id,user_id) SELECT id,user_id FROM stocks WHERE article_id=NEW.id;
END;
