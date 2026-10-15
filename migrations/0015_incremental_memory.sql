ALTER TABLE memories ADD COLUMN context_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE memories ADD COLUMN force_full INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memory_requests ADD COLUMN mode TEXT NOT NULL DEFAULT 'full';
ALTER TABLE processing_jobs ADD COLUMN memory_mode TEXT NOT NULL DEFAULT 'incremental';

CREATE TABLE memory_sources (
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  PRIMARY KEY (memory_id, article_id)
);
