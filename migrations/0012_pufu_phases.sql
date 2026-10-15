ALTER TABLE pufu_scores ADD COLUMN current_phase INTEGER NOT NULL DEFAULT 1 CHECK (current_phase > 0);

CREATE TABLE pufu_phases (
  pufu_id TEXT NOT NULL REFERENCES pufu_scores(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number > 0),
  score_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (pufu_id, number)
);

INSERT INTO pufu_phases (pufu_id, number, score_json, created_at, updated_at)
SELECT id, 1, score_json, created_at, updated_at FROM pufu_scores
WHERE status = 'ready' AND score_json IS NOT NULL;
