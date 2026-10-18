ALTER TABLE projects ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1));
ALTER TABLE projects ADD COLUMN public_id TEXT;
ALTER TABLE projects ADD COLUMN public_description TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN published_at TEXT;
CREATE UNIQUE INDEX projects_public_id ON projects(public_id) WHERE public_id IS NOT NULL;
CREATE INDEX projects_published ON projects(is_public, published_at DESC, public_id DESC);
