-- Google由来のプロフィールを消去し、全員が自分のニックネームで利用を開始する。
ALTER TABLE users DROP COLUMN email;
ALTER TABLE users ADD COLUMN onboarding_completed_at TEXT;
ALTER TABLE users ADD COLUMN terms_version TEXT;
ALTER TABLE users ADD COLUMN privacy_version TEXT;
UPDATE users SET name = '', avatar_url = NULL, memory_revision = memory_revision + 1;
-- 旧Google名を入力に使ったユーザーメモリを再利用しない。
DELETE FROM memories WHERE project_id IS NULL;
DELETE FROM ai_calls WHERE job_id IN (SELECT id FROM processing_jobs WHERE kind = 'user_memory');
-- Workflowの永続化ステップはCronで削除し、失敗した要求は次回へ残す。
CREATE TABLE privacy_cleanup_jobs (id TEXT PRIMARY KEY);
INSERT INTO privacy_cleanup_jobs (id) SELECT id FROM processing_jobs WHERE kind = 'user_memory';
UPDATE processing_jobs SET status = 'done', error = NULL WHERE kind = 'user_memory';
