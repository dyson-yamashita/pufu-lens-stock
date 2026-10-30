import type { Env, Job } from './env';
import type { WorkflowStep } from 'cloudflare:workers';
import { MAX_ATTEMPTS, deferJob } from './job-retries';

const windowStart = () => new Date(Date.now() - 86400000).toISOString();
const setting = (value: string | undefined, fallback: number) =>
  value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
    ? Number(value)
    : fallback;
export const limits = (env: Env) => ({
  pufu: setting(env.AI_PUFU_DAILY_LIMIT, 20),
  memory: setting(env.AI_MEMORY_DAILY_LIMIT, 48),
  article: setting(env.AI_ARTICLE_DAILY_LIMIT, 200),
  question: setting(env.AI_QUESTION_DAILY_LIMIT, 200),
  concurrent: setting(env.AI_CONCURRENT_JOBS, 5),
  calls: setting(env.AI_CALL_DAILY_LIMIT, 500),
  concurrentCalls: setting(env.AI_CONCURRENT_CALLS, 5),
});
const category = (kind: Job['kind']) => (kind.endsWith('_memory') ? 'memory' : kind);
export function reserveOperation(env: Env, job: Pick<Job, 'id' | 'user_id' | 'kind'>) {
  const kind = category(job.kind);
  const config = limits(env);
  const maximum = config[kind as 'pufu' | 'memory' | 'article' | 'question'];
  return env.DB.prepare(
    `INSERT OR IGNORE INTO ai_operations (id,user_id,kind)
    SELECT ?,?,? WHERE
    (SELECT COUNT(*) FROM ai_operations WHERE user_id=? AND kind=? AND created_at>?) < ?
    AND (SELECT COUNT(*) FROM ai_operations o JOIN processing_jobs j ON j.id=o.id
      WHERE o.user_id=? AND j.status NOT IN ('done','failed')
      AND NOT (j.kind='question' AND j.status='pending')) < ?
    AND (SELECT COUNT(*) FROM ai_attempts WHERE user_id=? AND created_at>?) < ?
    AND (SELECT COUNT(*) FROM ai_calls WHERE user_id=? AND status='running') < ?`,
  ).bind(
    job.id,
    job.user_id,
    kind,
    job.user_id,
    kind,
    windowStart(),
    maximum,
    job.user_id,
    config.concurrent,
    job.user_id,
    windowStart(),
    config.calls,
    job.user_id,
    config.concurrentCalls,
  );
}
export function assertOperation(env: Env, id: string) {
  return env.DB.prepare(
    'INSERT INTO quota_assertions (ok) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM ai_operations WHERE id=?)',
  ).bind(id);
}
class AiInvocationError extends Error {}
export async function invokeAi(
  env: Env,
  input: Parameters<NonNullable<Env['AI']>['run']>[1],
): Promise<unknown> {
  if (!env.AI) throw new Error('Workers AIが未設定です。');
  try {
    return await env.AI.run(env.AI_MODEL, input);
  } catch {
    throw new AiInvocationError(
      'AI処理の応答を確認できませんでした。重複生成を防ぐため停止しました。再試行してください。',
    );
  }
}
export class AiLimitError extends Error {
  constructor(public retryAt: string) {
    super(
      'AI処理の利用上限または同時処理数に達しました。処理中の完了を待つか、再試行時刻以降にお試しください。',
    );
  }
}
export async function retryAt(
  env: Env,
  userId: string,
  kind: Job['kind'] | 'stock' | 'calls',
): Promise<string> {
  if (kind === 'stock') {
    const row = await env.DB.prepare(
      'SELECT MIN(created_at) AS oldest FROM stock_usage WHERE user_id=? AND created_at>?',
    )
      .bind(userId, windowStart())
      .first<{ oldest: string | null }>();
    return new Date(
      row?.oldest ? Date.parse(row.oldest) + 86400001 : Date.now() + 60000,
    ).toISOString();
  }
  const config = limits(env);
  const rows = await env.DB.prepare(
    `SELECT kind,created_at FROM ai_operations WHERE user_id=? AND created_at>?
    UNION ALL SELECT 'calls',created_at FROM ai_attempts WHERE user_id=? AND created_at>?
    ORDER BY created_at DESC`,
  )
    .bind(userId, windowStart(), userId, windowStart())
    .all<{ kind: string; created_at: string }>();
  let at = Date.now() + 60000;
  const counts: Record<string, number> = {};
  for (const row of rows.results) {
    if (row.kind !== 'calls' && row.kind !== category(kind as Job['kind'])) continue;
    const maximum = config[row.kind as 'pufu' | 'memory' | 'article' | 'question' | 'calls'];
    counts[row.kind] = (counts[row.kind] ?? 0) + 1;
    if (counts[row.kind] === maximum) at = Math.max(at, Date.parse(row.created_at) + 86400001);
  }
  return new Date(at).toISOString();
}

export async function admitJob(env: Env, job: Job): Promise<boolean> {
  if (job.kind === 'cleanup') return true;
  await env.DB.batch([reserveOperation(env, job)]);
  return Boolean(
    await env.DB.prepare(
      `SELECT id FROM ai_operations WHERE id=? AND (? != 'question' OR (
        SELECT COUNT(*) FROM ai_operations o JOIN processing_jobs j ON j.id=o.id
        WHERE o.user_id=? AND j.id!=? AND j.status NOT IN ('done','failed')
        AND NOT (j.kind='question' AND j.status='pending')) < ?)`,
    )
      .bind(job.id, job.kind, job.user_id, job.id, limits(env).concurrent)
      .first(),
  );
}
// Workflowのステップ単位で結果と試行数を記録する。再実行は保存済み結果を再利用する。
export async function aiStep<T extends object>(
  env: Env,
  job: Job,
  step: WorkflowStep,
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  const outcome = await step.do(
    name,
    {
      retries: { limit: MAX_ATTEMPTS - 1, delay: '5 seconds', backoff: 'constant' },
      timeout: '3 minutes',
    },
    async () => {
      if (!(await admitJob(env, job)))
        return { retryAt: await retryAt(env, job.user_id, job.kind), json: null };
      if (!env.AI) return { retryAt: null, json: JSON.stringify(await operation()) };
      const id = `${job.id}:${name}`;
      const previous = await env.DB.prepare(
        'SELECT status,result_json,attempts,retry_blocked FROM ai_calls WHERE id=?',
      )
        .bind(id)
        .first<{
          status: string;
          result_json: string | null;
          attempts: number;
          retry_blocked: number;
        }>();
      if (previous?.status === 'done') return { retryAt: null, json: previous.result_json! };
      if (
        previous &&
        (previous.retry_blocked || previous.attempts >= MAX_ATTEMPTS) &&
        previous.status === 'failed'
      )
        throw new Error('AI処理の再試行上限に達しました。');
      const attempt = crypto.randomUUID();
      const config = limits(env);
      const results = await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO ai_calls (id,job_id,user_id,status) SELECT ?,?,?,'running'
        WHERE (SELECT COUNT(*) FROM ai_attempts WHERE user_id=? AND created_at>?) < ?
        AND (SELECT COUNT(*) FROM ai_calls WHERE user_id=? AND status='running') < ?
        ON CONFLICT(id) DO UPDATE SET status='running', attempts=ai_calls.attempts+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE ai_calls.status='failed' AND ai_calls.attempts<? AND ai_calls.retry_blocked=0`,
        ).bind(
          id,
          job.id,
          job.user_id,
          job.user_id,
          windowStart(),
          config.calls,
          job.user_id,
          config.concurrentCalls,
          MAX_ATTEMPTS,
        ),
        env.DB.prepare('INSERT INTO ai_attempts (id,user_id) SELECT ?,? WHERE changes()=1').bind(
          attempt,
          job.user_id,
        ),
      ]);
      if (!results[0].meta.changes)
        return { retryAt: await retryAt(env, job.user_id, 'calls'), json: null };
      let result: T;
      try {
        result = await operation();
      } catch (error) {
        await env.DB.prepare(
          "UPDATE ai_calls SET status='failed',retry_blocked=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
        )
          .bind(error instanceof AiInvocationError ? 1 : 0, id)
          .run();
        throw error;
      }
      await env.DB.prepare(
        job.kind === 'user_memory'
          ? "UPDATE ai_calls SET status='done',result_json=CASE WHEN EXISTS(SELECT 1 FROM users WHERE id=? AND memory_revision=? AND onboarding_completed_at IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM privacy_cleanup_jobs WHERE id=?) THEN ? ELSE NULL END,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?"
          : "UPDATE ai_calls SET status='done',result_json=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
      )
        .bind(
          ...(job.kind === 'user_memory'
            ? [job.user_id, job.revision, job.id, JSON.stringify(result), id]
            : [JSON.stringify(result), id]),
        )
        .run();
      return { retryAt: null, json: JSON.stringify(result) };
    },
  );
  if (outcome.retryAt) throw new AiLimitError(outcome.retryAt);
  return JSON.parse(outcome.json!) as T;
}
export async function deferLimitedJob(env: Env, job: Job, error: unknown): Promise<boolean> {
  if (!(error instanceof AiLimitError)) return false;
  const message = `${error.message} 再試行目安: ${error.retryAt}`;
  if (!(await deferJob(env, job, error.retryAt, message))) return true;
  const statements: D1PreparedStatement[] = [];
  if (job.kind === 'pufu' || job.kind === 'article') {
    const table = job.kind === 'pufu' ? 'pufu_scores' : 'articles';
    statements.push(
      env.DB.prepare(
        `UPDATE ${table} SET status='queued',error=? WHERE id=? AND user_id=? AND generation=? AND status!='ready' AND EXISTS (SELECT 1 FROM processing_jobs WHERE id=? AND status='pending')`,
      ).bind(message, job.target_id, job.user_id, job.revision, job.id),
    );
  } else if (job.kind === 'question') {
    statements.push(
      env.DB.prepare(
        "UPDATE questions SET status='queued',error=? WHERE stock_id=? AND generation=? AND source='ai' AND status!='ready' AND EXISTS (SELECT 1 FROM processing_jobs WHERE id=? AND status='pending')",
      ).bind(message, job.target_id, job.revision, job.id),
    );
  }
  if (statements.length) await env.DB.batch(statements);
  return true;
}
