ALTER TABLE pufu_scores ADD COLUMN title TEXT CHECK (title IS NULL OR (length(title) BETWEEN 1 AND 200));
