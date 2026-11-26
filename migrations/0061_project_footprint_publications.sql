CREATE TABLE project_footprint_publications (
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 140),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 1000),
  PRIMARY KEY (project_id,revision),
  FOREIGN KEY (project_id,revision) REFERENCES project_footprints(project_id,revision) ON DELETE CASCADE
);
