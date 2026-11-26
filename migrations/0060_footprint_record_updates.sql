ALTER TABLE reflections ADD COLUMN footprint_edited_at TEXT;
-- statement-breakpoint
CREATE TRIGGER mark_reflection_footprint_edit AFTER UPDATE OF text,answer ON reflections
WHEN NEW.text IS NOT OLD.text OR NEW.answer IS NOT OLD.answer
BEGIN
  UPDATE reflections SET footprint_edited_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id;
END;
-- statement-breakpoint
-- statement-breakpoint
ALTER TABLE questions ADD COLUMN footprint_moved_at TEXT;
-- statement-breakpoint
CREATE TRIGGER mark_question_footprint_move AFTER UPDATE OF project_id ON questions
WHEN NEW.project_id IS NOT OLD.project_id
BEGIN
  UPDATE questions SET footprint_moved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id;
END;
-- statement-breakpoint
ALTER TABLE pufu_scores ADD COLUMN footprint_moved_at TEXT;
-- statement-breakpoint
CREATE TRIGGER mark_pufu_footprint_move AFTER UPDATE OF project_id ON pufu_scores
WHEN NEW.project_id IS NOT OLD.project_id
BEGIN
  UPDATE pufu_scores SET footprint_moved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id;
END;
-- statement-breakpoint
CREATE TRIGGER delete_project_footprint_job BEFORE DELETE ON project_footprints
BEGIN
  UPDATE ai_calls SET result_json=NULL WHERE job_id=OLD.job_id;
  UPDATE processing_jobs SET status='done',error=NULL WHERE id=OLD.job_id;
END;
