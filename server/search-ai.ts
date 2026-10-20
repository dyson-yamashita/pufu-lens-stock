import type { Env, EmbeddingAI } from './env';
import { limits } from './usage';

export const embeddingModel = '@cf/baai/bge-m3' as const;
export const embeddingDimensions = 1024;
export type SearchFailure = 'not_configured' | 'rate_limited' | 'service_error' | 'index_pending';
export class SearchError extends Error {
  constructor(
    readonly reason: SearchFailure,
    readonly status: 429 | 503 = 503,
  ) {
    super(
      reason === 'rate_limited'
        ? '意味検索の利用上限またはAIの同時処理数に達しました。時間をおいて再試行してください。'
        : reason === 'index_pending'
          ? '意味検索の索引を作成中です。キーワード検索を使うか、しばらくして再試行してください。'
          : reason === 'not_configured'
            ? '意味検索には管理者によるWorkers AIとVectorizeの設定が必要です。'
            : '意味検索のサービスに接続できませんでした。時間をおいて再試行してください。',
    );
  }
}
export async function searchTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SearchError('service_error')), 15000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const maximum = (value: string | undefined, fallback: number) =>
  value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
    ? Number(value)
    : fallback;

export async function embedSearchText(
  env: Env,
  userId: string,
  text: string,
  kind: 'query' | 'index',
): Promise<number[]> {
  if (!env.AI) throw new SearchError('not_configured');
  const id = 'embedding-' + crypto.randomUUID();
  const category = 'search-' + kind;
  const window = new Date(Date.now() - 86400000).toISOString();
  const budget = limits(env);
  const daily = maximum(
    kind === 'query' ? env.AI_SEARCH_DAILY_LIMIT : env.AI_INDEX_DAILY_LIMIT,
    kind === 'query' ? 100 : 200,
  );
  const [reserved] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ai_calls(id,job_id,user_id,status)
      SELECT ?,?,?,'running' WHERE EXISTS(SELECT 1 FROM users WHERE id=?)
      AND (SELECT COUNT(*) FROM ai_attempts WHERE user_id=? AND created_at>?)<?
      AND (SELECT COUNT(*) FROM ai_calls WHERE user_id=? AND status='running')<?
      AND (SELECT COUNT(*) FROM ai_calls c JOIN ai_attempts a ON a.id=c.id
        WHERE c.user_id=? AND c.job_id=? AND a.created_at>?)<?`,
    ).bind(
      id,
      category,
      userId,
      userId,
      userId,
      window,
      budget.calls,
      userId,
      budget.concurrentCalls,
      userId,
      category,
      window,
      daily,
    ),
    env.DB.prepare('INSERT INTO ai_attempts(id,user_id) SELECT ?,? WHERE changes()=1').bind(
      id,
      userId,
    ),
  ]);
  if (!reserved.meta.changes) throw new SearchError('rate_limited', 429);
  let success = false;
  try {
    // 同じWorkers AI bindingでも、埋め込みモデルは生成モデルと入力形式が異なる。
    const ai = env.AI as unknown as EmbeddingAI;
    const result = await searchTimeout(
      ai.run(embeddingModel, { text: [text.slice(0, 8000)], truncate_inputs: true }),
    );
    const data = result && typeof result === 'object' && 'data' in result ? result.data : null;
    const vector: unknown = Array.isArray(data) ? data[0] : null;
    if (
      !Array.isArray(vector) ||
      vector.length !== embeddingDimensions ||
      !vector.every((value) => typeof value === 'number' && Number.isFinite(value)) ||
      !vector.some((value) => value !== 0)
    )
      throw new SearchError('service_error');
    success = true;
    return vector as number[];
  } catch (error) {
    if (error instanceof SearchError) throw error;
    throw new SearchError('service_error');
  } finally {
    await env.DB.prepare('UPDATE ai_calls SET status=?,updated_at=? WHERE id=?')
      .bind(success ? 'done' : 'failed', new Date().toISOString(), id)
      .run();
  }
}
