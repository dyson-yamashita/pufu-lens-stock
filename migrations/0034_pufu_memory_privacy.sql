-- 0033で進めた世代を下限とし、旧Workflowの入力キャッシュも再採用しない。
ALTER TABLE users ADD COLUMN memory_privacy_revision INTEGER NOT NULL DEFAULT 0;
UPDATE users SET memory_privacy_revision=memory_revision;
ALTER TABLE privacy_cleanup_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'user_memory' CHECK(kind IN ('user_memory','pufu'));
INSERT OR IGNORE INTO privacy_cleanup_jobs(id,kind)
SELECT j.id,'pufu' FROM processing_jobs j JOIN pufu_scores p ON p.id=j.target_id
WHERE j.kind='pufu' AND json_valid(p.input_json) AND json_type(p.input_json,'$.userMemory') NOT IN ('null');
DELETE FROM ai_calls WHERE job_id IN (SELECT id FROM privacy_cleanup_jobs);
UPDATE processing_jobs SET status='done',error=NULL WHERE id IN (SELECT id FROM privacy_cleanup_jobs);
-- 完成済みの本文・局面は保持し、旧入力で生成中のプ譜だけ停止して再試行可能にする。
UPDATE pufu_scores SET generation=generation+1,status='failed',error='登録情報の更新により生成を停止しました。初回登録後に再試行してください。'
WHERE status IN ('queued','generating') AND id IN (SELECT j.target_id FROM processing_jobs j JOIN privacy_cleanup_jobs c ON c.id=j.id WHERE c.kind='pufu');
UPDATE pufu_scores SET input_json=json_set(input_json,'$.userMemory',NULL)
WHERE json_valid(input_json) AND json_type(input_json,'$.userMemory') IS NOT NULL;
