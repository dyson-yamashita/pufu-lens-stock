DROP TRIGGER queue_live_footprint;
-- statement-breakpoint
ALTER TABLE projects RENAME COLUMN footprint_interval TO previous_footprint_interval;
-- statement-breakpoint
ALTER TABLE projects ADD COLUMN footprint_interval INTEGER NOT NULL DEFAULT 5 CHECK (footprint_interval IN (3,5,10));
-- statement-breakpoint
UPDATE projects SET footprint_interval=previous_footprint_interval WHERE previous_footprint_interval IN (3,10);
-- statement-breakpoint
ALTER TABLE projects DROP COLUMN previous_footprint_interval;
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
