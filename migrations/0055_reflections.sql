CREATE TABLE reflections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  is_weekly INTEGER NOT NULL CHECK (is_weekly IN (0,1)),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL CHECK (start_at < end_at),
  generation INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','ready','empty','failed')),
  text TEXT,
  previous_questions TEXT NOT NULL DEFAULT '[]',
  source_revision INTEGER,
  stock_ids TEXT NOT NULL DEFAULT '[]',
  pufu_ids TEXT NOT NULL DEFAULT '[]',
  answer TEXT,
  dismissed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- statement-breakpoint
CREATE INDEX reflections_project ON reflections(project_id,created_at DESC,id DESC);
-- statement-breakpoint
CREATE UNIQUE INDEX reflections_week ON reflections(project_id,end_at) WHERE is_weekly=1;
-- statement-breakpoint
CREATE UNIQUE INDEX reflections_generating ON reflections(project_id) WHERE status='queued';
-- statement-breakpoint
CREATE INDEX stocks_reflection_period ON stocks(project_id,created_at DESC,id DESC);
-- statement-breakpoint
ALTER TABLE processing_jobs ADD COLUMN purpose TEXT NOT NULL DEFAULT '' CHECK (purpose IN ('','reflection'));
-- statement-breakpoint
CREATE INDEX reflection_jobs ON processing_jobs(target_id) WHERE kind='question' AND purpose='reflection';
-- statement-breakpoint
-- 削除されたプロジェクトの生成結果を、ジョブやAIの再実行から復元させない。
CREATE TRIGGER finish_deleted_reflection BEFORE DELETE ON reflections
BEGIN
  UPDATE ai_calls SET result_json=NULL
  WHERE job_id IN (SELECT id FROM processing_jobs WHERE kind='question' AND purpose='reflection' AND target_id=OLD.id);
  UPDATE processing_jobs SET status='done',error=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE kind='question' AND purpose='reflection' AND target_id=OLD.id;
END;
