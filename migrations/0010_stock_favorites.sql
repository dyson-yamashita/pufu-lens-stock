ALTER TABLE stocks ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1));
CREATE INDEX stocks_favorites ON stocks(user_id, created_at DESC, id DESC) WHERE is_favorite = 1;
