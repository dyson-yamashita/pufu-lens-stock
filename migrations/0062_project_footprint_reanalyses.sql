CREATE TABLE project_footprint_reanalyses (
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  generation INTEGER NOT NULL,
  job_id TEXT NOT NULL UNIQUE,
  completed_generation INTEGER,
  result_json TEXT,
  evidence_ids TEXT NOT NULL DEFAULT '[]',
  dependencies TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  prompt_version INTEGER,
  analyzed_at TEXT,
  public_id TEXT,
  PRIMARY KEY (project_id,revision),
  FOREIGN KEY (project_id,revision) REFERENCES project_footprints(project_id,revision) ON DELETE CASCADE
);
-- statement-breakpoint
ALTER TABLE project_footprints ADD COLUMN public_id TEXT;
-- statement-breakpoint
CREATE INDEX project_footprints_timeline ON project_footprints(project_id,end_at,revision);
-- statement-breakpoint
ALTER TABLE stocks ADD COLUMN footprint_public_at TEXT;
-- statement-breakpoint
UPDATE stocks SET footprint_public_at=footprint_edited_at WHERE footprint_edited_at IS NOT NULL;
-- statement-breakpoint
CREATE TRIGGER mark_public_footprint_stock_edit AFTER UPDATE OF title,article_id,project_id ON stocks
WHEN NEW.title IS NOT OLD.title OR NEW.article_id IS NOT OLD.article_id OR NEW.project_id IS NOT OLD.project_id
BEGIN
  UPDATE stocks SET footprint_public_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id;
END;
-- statement-breakpoint
ALTER TABLE questions ADD COLUMN footprint_public_at TEXT;
-- statement-breakpoint
UPDATE questions SET footprint_public_at=updated_at WHERE updated_at<>created_at;
-- statement-breakpoint
CREATE TRIGGER mark_public_footprint_question_edit AFTER UPDATE OF text,source,project_id ON questions
WHEN NEW.text IS NOT OLD.text OR NEW.source IS NOT OLD.source OR NEW.project_id IS NOT OLD.project_id
BEGIN
  UPDATE questions SET footprint_public_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id;
END;
-- statement-breakpoint
CREATE TRIGGER clear_replaced_footprint_reanalysis_cache
BEFORE UPDATE OF job_id ON project_footprint_reanalyses
WHEN NEW.job_id IS NOT OLD.job_id
BEGIN
  UPDATE ai_calls SET result_json=NULL WHERE job_id=OLD.job_id;
END;
-- statement-breakpoint
CREATE TRIGGER delete_footprint_reanalysis_job BEFORE DELETE ON project_footprint_reanalyses
BEGIN
  UPDATE ai_calls SET result_json=NULL WHERE job_id=OLD.job_id;
  UPDATE processing_jobs SET status='done',error=NULL WHERE id=OLD.job_id;
END;
-- statement-breakpoint
CREATE TRIGGER stop_footprint_reanalysis_jobs AFTER UPDATE OF include_in_user_memory ON projects
WHEN OLD.include_in_user_memory=1 AND NEW.include_in_user_memory=0
BEGIN
  UPDATE ai_calls SET result_json=NULL WHERE job_id IN (
    SELECT job_id FROM project_footprint_reanalyses WHERE project_id=NEW.id
  );
  UPDATE processing_jobs SET status='failed',error=NULL
  WHERE status IN ('pending','dispatched','running') AND id IN (
    SELECT job_id FROM project_footprint_reanalyses WHERE project_id=NEW.id
  );
END;
