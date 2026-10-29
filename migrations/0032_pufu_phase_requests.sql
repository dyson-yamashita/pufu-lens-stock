-- MCPの局面追加の再送結果を、プ譜のその後の編集と分けて保持する。
CREATE TABLE pufu_phase_requests (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  pufu_id TEXT NOT NULL REFERENCES pufu_scores(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  phase INTEGER NOT NULL CHECK (phase > 1),
  revision INTEGER NOT NULL CHECK (revision > 1),
  updated_at TEXT NOT NULL,
  comment_id TEXT,
  PRIMARY KEY (user_id, request_id)
);
CREATE INDEX pufu_phase_requests_pufu ON pufu_phase_requests(pufu_id);
