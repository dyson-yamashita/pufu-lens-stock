CREATE TABLE stock_images (
  id TEXT PRIMARY KEY,
  stock_id TEXT NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  content_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- statement-breakpoint
CREATE INDEX stock_images_stock ON stock_images(stock_id, created_at, id);
-- statement-breakpoint
-- No FK: deletion must be retried even after the stock/project/account is gone.
CREATE TABLE stock_image_cleanup (
  content_key TEXT PRIMARY KEY,
  generation TEXT NOT NULL DEFAULT (lower(hex(randomblob(16))))
);
-- statement-breakpoint
-- A write remains discoverable if its parent is deleted before R2.put completes.
CREATE TABLE stock_image_writes (
  content_key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_checked_at TEXT NOT NULL DEFAULT ''
);
-- statement-breakpoint
CREATE TRIGGER stock_images_insert AFTER INSERT ON stock_images BEGIN
  INSERT INTO stock_image_writes(content_key) VALUES (NEW.content_key);
END;
-- statement-breakpoint
CREATE TRIGGER stock_images_delete AFTER DELETE ON stock_images BEGIN
  INSERT OR IGNORE INTO stock_image_cleanup(content_key) VALUES (OLD.content_key);
END;
