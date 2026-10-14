ALTER TABLE questions ADD COLUMN source TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'user'));
CREATE INDEX questions_source ON questions(source, created_at DESC);
