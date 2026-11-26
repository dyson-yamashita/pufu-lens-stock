ALTER TABLE projects ADD COLUMN footprints_enabled INTEGER NOT NULL DEFAULT 1 CHECK (footprints_enabled IN (0,1));
-- statement-breakpoint
ALTER TABLE projects ADD COLUMN footprint_interval INTEGER NOT NULL DEFAULT 3 CHECK (footprint_interval IN (1,3,5,10));
-- statement-breakpoint
ALTER TABLE memory_versions ADD COLUMN footprint_live INTEGER NOT NULL DEFAULT 0 CHECK (footprint_live IN (0,1));
-- statement-breakpoint
ALTER TABLE memory_versions ADD COLUMN footprint_source_ids TEXT;
-- statement-breakpoint
CREATE INDEX memory_versions_footprints ON memory_versions(project_id,saved_at,revision);
-- statement-breakpoint
CREATE INDEX memory_versions_footprints_revision ON memory_versions(project_id,revision);
-- statement-breakpoint

CREATE TABLE project_footprints (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  previous_revision INTEGER,
  revisions TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  update_count INTEGER NOT NULL,
  job_id TEXT NOT NULL UNIQUE,
  result_json TEXT,
  evidence_ids TEXT NOT NULL DEFAULT '[]',
  dependencies TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  prompt_version INTEGER,
  created_at TEXT,
  PRIMARY KEY (project_id,revision)
);
-- statement-breakpoint

CREATE TABLE footprint_cursors (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  previous_revision INTEGER,
  updates INTEGER NOT NULL DEFAULT 0
);
-- statement-breakpoint

CREATE TABLE footprint_backfills (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  max_revision INTEGER NOT NULL,
  interval INTEGER NOT NULL,
  cursor_at TEXT,
  cursor_revision INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);
-- statement-breakpoint

CREATE TRIGGER queue_live_footprint AFTER INSERT ON memory_versions
WHEN NEW.project_id IS NOT NULL AND NEW.footprint_live=1
BEGIN
  INSERT INTO footprint_cursors(project_id,previous_revision,updates)
  SELECT NEW.project_id,last.revision,
    CASE WHEN last.revision IS NULL THEN 1 ELSE (
      SELECT COUNT(*) FROM memory_versions v
      WHERE v.project_id=NEW.project_id AND v.revision>last.revision AND v.revision<=NEW.revision
    ) END
  FROM (
    SELECT MAX(f.revision) AS revision FROM project_footprints f
    WHERE f.project_id=NEW.project_id AND f.revision<NEW.revision
      AND NOT EXISTS(SELECT 1 FROM footprint_cursors c WHERE c.project_id=NEW.project_id AND c.previous_revision IS NOT NULL)
  ) last WHERE 1
  ON CONFLICT(project_id) DO UPDATE SET
    updates=CASE WHEN excluded.previous_revision IS NULL THEN updates+1 ELSE excluded.updates END,
    previous_revision=COALESCE(previous_revision,excluded.previous_revision);

  INSERT INTO project_footprints
    (project_id,revision,previous_revision,revisions,start_at,end_at,update_count,job_id)
  SELECT NEW.project_id,NEW.revision,c.previous_revision,
    (SELECT json_group_array(revision) FROM (
      SELECT revision FROM memory_versions v
      WHERE v.project_id=NEW.project_id AND (
        (c.previous_revision IS NULL AND v.revision=NEW.revision)
        OR (v.revision>c.previous_revision AND v.revision<=NEW.revision)
      )
      ORDER BY revision
    )),
    COALESCE(prev.saved_at,NEW.saved_at),NEW.saved_at,c.updates,
    'footprint-' || NEW.project_id || '-' || NEW.revision
  FROM footprint_cursors c JOIN projects p ON p.id=c.project_id
  LEFT JOIN memory_versions prev ON prev.memory_id=NEW.memory_id AND prev.revision=c.previous_revision
  WHERE c.project_id=NEW.project_id AND p.footprints_enabled=1
    AND (c.previous_revision IS NULL OR c.updates>=p.footprint_interval);

  UPDATE footprint_cursors SET previous_revision=NEW.revision,updates=0
  WHERE project_id=NEW.project_id AND EXISTS (
    SELECT 1 FROM project_footprints f WHERE f.project_id=NEW.project_id AND f.revision=NEW.revision
  );
END;
-- statement-breakpoint

CREATE TABLE footprint_history_epoch (
  deployed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- statement-breakpoint
INSERT INTO footprint_history_epoch DEFAULT VALUES;
-- statement-breakpoint
ALTER TABLE stocks ADD COLUMN footprint_edited_at TEXT;
-- statement-breakpoint
CREATE TRIGGER mark_stock_footprint_edit AFTER UPDATE OF note,title,article_id,project_id ON stocks
WHEN NEW.note IS NOT OLD.note OR NEW.title IS NOT OLD.title OR NEW.article_id IS NOT OLD.article_id
  OR NEW.project_id IS NOT OLD.project_id
BEGIN
  UPDATE stocks SET footprint_edited_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id;
END;
-- statement-breakpoint
