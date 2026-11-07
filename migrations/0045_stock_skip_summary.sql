ALTER TABLE articles ADD COLUMN skip_summary INTEGER NOT NULL DEFAULT 0 CHECK (skip_summary IN (0, 1));
