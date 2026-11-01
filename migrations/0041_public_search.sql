ALTER TABLE projects ADD COLUMN search_indexable INTEGER NOT NULL DEFAULT 0 CHECK (search_indexable IN (0,1));
CREATE INDEX projects_public_search ON projects(is_public,search_indexable,public_id);
-- The implicit second key is rowid, use it for fixed-size sitemap range reads.
CREATE INDEX public_search_questions_project ON questions(project_id);
CREATE INDEX public_search_pufus_project ON pufu_scores(project_id);
