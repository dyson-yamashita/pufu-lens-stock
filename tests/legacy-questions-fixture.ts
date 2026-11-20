import type { Env } from '../server/env';
import { queueQuestionJobStatement } from '../server/infrastructure/db';

// 過去バージョンが保存時に作っていた、ストック単位の問いを用意する。
export function legacyQuestionStatements(env: Env, stockId: string | null = null) {
  return [
    env.DB.prepare(
      `INSERT OR IGNORE INTO questions (id,project_id,stock_id,status,created_at)
      SELECT 'question-'||s.id,s.project_id,s.id,'queued',s.created_at
      FROM stocks s WHERE (?1 IS NULL OR s.id=?1) AND s.ai_question_dismissed=0`,
    ).bind(stockId),
    queueQuestionJobStatement(env, stockId),
  ];
}
