ALTER TABLE projects ADD COLUMN auto_generate_questions INTEGER NOT NULL DEFAULT 1 CHECK (auto_generate_questions IN (0, 1));
