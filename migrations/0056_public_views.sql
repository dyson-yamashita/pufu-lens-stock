CREATE TABLE public_view_pending (
  day TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('project','stocks','questions','pufus')),
  item_id TEXT NOT NULL,
  views INTEGER NOT NULL CHECK (views > 0),
  PRIMARY KEY (day,project_id,kind,item_id)
) WITHOUT ROWID;

CREATE TABLE public_view_totals (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('project','stocks','questions','pufus')),
  item_id TEXT NOT NULL,
  views INTEGER NOT NULL CHECK (views > 0),
  PRIMARY KEY (project_id,kind,item_id)
) WITHOUT ROWID;

CREATE INDEX public_view_pending_project ON public_view_pending(project_id);
