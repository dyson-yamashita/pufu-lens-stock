ALTER TABLE articles ADD COLUMN source_type TEXT NOT NULL DEFAULT 'url' CHECK (source_type IN ('url', 'text'));
ALTER TABLE articles ADD COLUMN input_text TEXT;
