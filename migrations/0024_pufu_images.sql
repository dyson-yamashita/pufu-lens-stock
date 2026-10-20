-- 削除後のR2書き込みを回収するため、外部キーで消さない。
CREATE TABLE pufu_image_entries (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pufu_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  phase INTEGER NOT NULL,
  render_version TEXT NOT NULL DEFAULT '1',
  current INTEGER NOT NULL DEFAULT 1,
  ready INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  touched INTEGER NOT NULL DEFAULT 0,
  write_pending INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  byte_length INTEGER,
  lease_until TEXT,
  next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- statement-breakpoint
CREATE UNIQUE INDEX pufu_image_current ON pufu_image_entries(pufu_id) WHERE current=1;
-- statement-breakpoint
CREATE INDEX pufu_image_pending ON pufu_image_entries(current,ready,failed,next_attempt_at);
-- statement-breakpoint
INSERT INTO pufu_image_entries(pufu_id,user_id,revision,phase)
SELECT id,user_id,revision,current_phase FROM pufu_scores WHERE status='ready';
-- statement-breakpoint
CREATE TRIGGER pufu_image_insert AFTER INSERT ON pufu_scores WHEN NEW.status='ready'
BEGIN
  INSERT INTO pufu_image_entries(pufu_id,user_id,revision,phase) VALUES(NEW.id,NEW.user_id,NEW.revision,NEW.current_phase);
END;
-- statement-breakpoint
CREATE TRIGGER pufu_image_update AFTER UPDATE OF score_json,status,current_phase,revision ON pufu_scores
WHEN NEW.score_json IS NOT OLD.score_json OR NEW.status IS NOT OLD.status OR NEW.current_phase<>OLD.current_phase OR NEW.revision<>OLD.revision
BEGIN
  UPDATE pufu_image_entries SET current=0,next_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE pufu_id=NEW.id AND current=1;
  INSERT INTO pufu_image_entries(pufu_id,user_id,revision,phase)
  SELECT NEW.id,NEW.user_id,NEW.revision,NEW.current_phase WHERE NEW.status='ready';
END;
-- statement-breakpoint
CREATE TRIGGER pufu_image_delete AFTER DELETE ON pufu_scores
BEGIN
  UPDATE pufu_image_entries SET current=0,next_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE pufu_id=OLD.id;
END;
