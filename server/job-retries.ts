import type { Env, Job, JobStateGuard } from './env';
import { jobFailureStatements, now } from './db';

export const MAX_ATTEMPTS = 10;
export const MAX_WAIT_MS = 30 * 60 * 1000;

export async function stopWaitingJob(env: Env, job: Job): Promise<boolean> {
  const state = await env.DB.prepare(
    'SELECT j.status,COALESCE(a.attempts,0) AS dispatch_attempts,j.created_at FROM processing_jobs j LEFT JOIN job_dispatch_attempts a ON a.job_id=j.id WHERE j.id=?',
  )
    .bind(job.id)
    .first<{ status: string; dispatch_attempts: number; created_at: string }>();
  if (!state || state.status === 'done' || state.status === 'failed') return true;
  if (state.status !== 'pending' && state.status !== 'dispatched') return false;
  const message =
    Date.now() - Date.parse(state.created_at) >= MAX_WAIT_MS
      ? 'AI処理の待機期限（受付から30分）に達したため停止しました。再試行してください。'
      : state.status === 'pending' && state.dispatch_attempts >= MAX_ATTEMPTS
        ? '処理の起動試行が上限の10回に達したため停止しました。再試行してください。'
        : null;
  if (!message) return false;
  const results = await env.DB.batch([
    ...jobFailureStatements(env, job, message, { status: state.status }),
    env.DB.prepare(
      "DELETE FROM ai_deferrals WHERE job_id=? AND EXISTS (SELECT 1 FROM processing_jobs WHERE id=? AND status='failed')",
    ).bind(job.id, job.id),
  ]);
  return Boolean(results[0].meta.changes);
}

export async function deferJob(
  env: Env,
  job: Job,
  retryAt: string,
  message: string,
  guard: JobStateGuard = {},
): Promise<boolean> {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE processing_jobs SET status='pending',error=?,updated_at=? WHERE id=? AND status NOT IN ('done','failed') AND (? IS NULL OR status=?) AND (? IS NULL OR COALESCE((SELECT attempts FROM job_dispatch_attempts WHERE job_id=processing_jobs.id),0)=?) AND (? IS NULL OR updated_at=?)",
    ).bind(
      message,
      now(),
      job.id,
      guard.status ?? null,
      guard.status ?? null,
      guard.attempts ?? null,
      guard.attempts ?? null,
      guard.updatedAt ?? null,
      guard.updatedAt ?? null,
    ),
    env.DB.prepare(
      "INSERT INTO ai_deferrals (job_id,retry_at) SELECT ?,? WHERE changes()=1 AND EXISTS (SELECT 1 FROM processing_jobs WHERE id=? AND status='pending') ON CONFLICT(job_id) DO UPDATE SET retry_at=excluded.retry_at",
    ).bind(job.id, retryAt, job.id),
  ]);
  return !(await stopWaitingJob(env, job));
}
