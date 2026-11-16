ALTER TABLE articles ADD COLUMN has_og_image INTEGER NOT NULL DEFAULT 0 CHECK (has_og_image IN (0, 1));
