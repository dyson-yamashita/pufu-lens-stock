ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'ja';
-- statement-breakpoint
ALTER TABLE memories ADD COLUMN language TEXT NOT NULL DEFAULT 'ja';
-- statement-breakpoint
-- Empty is an insert-only sentinel; the trigger resolves it in the same statement.
ALTER TABLE processing_jobs ADD COLUMN language TEXT NOT NULL DEFAULT '';
-- statement-breakpoint
UPDATE processing_jobs SET language='ja';
-- statement-breakpoint
-- Every enqueuer, including older Workers, snapshots the account atomically.
-- Explicit snapshots are used by delayed child jobs accepted with their parent.
CREATE TRIGGER processing_jobs_language_snapshot AFTER INSERT ON processing_jobs
WHEN NEW.language=''
BEGIN
  UPDATE processing_jobs SET language=COALESCE((SELECT language FROM users WHERE id=NEW.user_id),'ja') WHERE id=NEW.id;
END;
