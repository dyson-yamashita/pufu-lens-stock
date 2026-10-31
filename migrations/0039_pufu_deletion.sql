-- 作成リクエストの再送で、削除済みのプ譜IDを再利用しない。
-- 課題・本文は保持せず、退会時には削除履歴も消す。
CREATE TABLE deleted_pufus (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
-- statement-breakpoint
CREATE TRIGGER remember_deleted_pufu AFTER DELETE ON pufu_scores
WHEN EXISTS (SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN
  INSERT OR IGNORE INTO deleted_pufus(id,user_id) VALUES (OLD.id,OLD.user_id);
END;
-- statement-breakpoint
CREATE TRIGGER prevent_deleted_pufu_recreation BEFORE INSERT ON pufu_scores
WHEN EXISTS (SELECT 1 FROM deleted_pufus WHERE id=NEW.id)
BEGIN
  SELECT RAISE(IGNORE);
END;
