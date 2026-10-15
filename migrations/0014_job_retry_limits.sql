CREATE TABLE job_dispatch_attempts (
  job_id TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0
);
