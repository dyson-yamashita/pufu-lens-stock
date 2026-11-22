CREATE TABLE public_view_daily (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('project','stocks','questions','pufus')),
  item_id TEXT NOT NULL,
  views INTEGER NOT NULL CHECK (views > 0),
  PRIMARY KEY (project_id,day,kind,item_id)
) WITHOUT ROWID;
