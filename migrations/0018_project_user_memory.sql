ALTER TABLE projects ADD COLUMN include_in_user_memory INTEGER NOT NULL DEFAULT 1 CHECK (include_in_user_memory IN (0, 1));
