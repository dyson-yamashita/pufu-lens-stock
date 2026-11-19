-- ストックの本文編集で参照記事を付け替えた場合も、以前の検索索引を無効にする。
DROP TRIGGER stock_search_update;
-- statement-breakpoint
CREATE TRIGGER stock_search_update AFTER UPDATE OF title,note,project_id,article_id ON stocks
WHEN NEW.title IS NOT OLD.title OR NEW.note IS NOT OLD.note
  OR NEW.project_id IS NOT OLD.project_id OR NEW.article_id IS NOT OLD.article_id
BEGIN
  UPDATE stock_search_entries SET current=0,next_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE stock_id=NEW.id AND current=1;
  INSERT INTO stock_search_entries(stock_id,user_id) VALUES(NEW.id,NEW.user_id);
END;
