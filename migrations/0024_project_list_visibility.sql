ALTER TABLE projects ADD COLUMN show_in_all_lists INTEGER NOT NULL DEFAULT 1 CHECK (show_in_all_lists IN (0, 1));
