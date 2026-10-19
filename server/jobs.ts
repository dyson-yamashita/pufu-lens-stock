import type { Env, Job } from './env';
import { admitJob, retryAt } from './usage';
import { now, queueQuestionJobStatement, jobFailureStatements } from './db';
import { cleanupDeletedAccounts } from './account';
import { MAX_ATTEMPTS, MAX_WAIT_MS, stopWaitingJob, deferJob } from './job-retries';

export async function dispatchJobs(env: Env): Promise<void> {
  // 未開始の古い世代だけを集約する。最新の要求は上限時もpendingのまま残す。
  await env.DB.prepare(
    `UPDATE processing_jobs SET status='done', updated_at=? WHERE status='pending'
    AND ((kind='user_memory' AND revision < (SELECT memory_revision FROM users WHERE id=target_id))
      OR (kind='project_memory' AND revision < (SELECT memory_revision FROM projects WHERE id=target_id)))`,
  )
    .bind(now())
    .run();
  const expired = await env.DB.prepare(
    "SELECT j.* FROM processing_jobs j LEFT JOIN job_dispatch_attempts a ON a.job_id=j.id WHERE j.status IN ('pending','dispatched') AND ((j.status='pending' AND COALESCE(a.attempts,0)>=?) OR j.created_at<=?)",
  )
    .bind(MAX_ATTEMPTS, new Date(Date.now() - MAX_WAIT_MS).toISOString())
    .all<Job>();
  for (const job of expired.results) await stopWaitingJob(env, job);
  const pending = await env.DB.prepare(
    "SELECT * FROM processing_jobs WHERE status = 'pending' AND NOT EXISTS (SELECT 1 FROM ai_deferrals d WHERE d.job_id=processing_jobs.id AND d.retry_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) ORDER BY CASE kind WHEN 'article' THEN 0 WHEN 'cleanup' THEN 1 WHEN 'question' THEN 2 ELSE 3 END, created_at LIMIT 20",
  ).all<Job>();
  for (const job of pending.results) {
    // Workflow起動前に取得権を確定する。起動直後のpending/doneを上書きしない。
    const claimedAt = now();
    const claimed = await env.DB.batch([
      env.DB.prepare(
        "UPDATE processing_jobs SET status='dispatched',error=NULL,updated_at=? WHERE id=? AND status='pending' AND COALESCE((SELECT attempts FROM job_dispatch_attempts WHERE job_id=processing_jobs.id),0)<? AND created_at>? AND NOT EXISTS (SELECT 1 FROM ai_deferrals d WHERE d.job_id=processing_jobs.id AND d.retry_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
      ).bind(claimedAt, job.id, MAX_ATTEMPTS, new Date(Date.now() - MAX_WAIT_MS).toISOString()),
      env.DB.prepare(
        'INSERT INTO job_dispatch_attempts (job_id,attempts) SELECT ?,1 WHERE changes()=1 ON CONFLICT(job_id) DO UPDATE SET attempts=job_dispatch_attempts.attempts+1',
      ).bind(job.id),
    ]);
    if (!claimed[0].meta.changes) continue;
    const binding =
      job.kind === 'article' ||
      job.kind === 'cleanup' ||
      job.kind === 'question' ||
      job.kind === 'pufu'
        ? env.ARTICLE_WORKFLOW
        : env.MEMORY_WORKFLOW;
    try {
      if (!(await admitJob(env, job))) {
        const at = await retryAt(env, job.user_id, job.kind);
        await deferJob(env, job, at, `AI処理の利用枠の回復を待っています。再試行目安: ${at}`);
        continue;
      }
      try {
        await binding.create({ id: job.id, params: { jobId: job.id } });
      } catch {
        const existing = await binding.get(job.id);
        const state = await existing.status();
        if (['complete', 'errored', 'terminated'].includes(state.status)) await existing.restart();
      }
    } catch {
      await deferJob(
        env,
        job,
        new Date(Date.now() + 60000).toISOString(),
        '処理を起動できなかったため、再試行を待っています。',
        { status: 'dispatched', updatedAt: claimedAt },
      );
      console.error('workflow_dispatch_pending', { jobId: job.id });
    }
  }
}
export async function scheduledMaintenance(env: Env): Promise<void> {
  await cleanupDeletedAccounts(env);
  // 結果の保存前にWorkerが終了した場合、同じAIを再発行せず失敗として回復する。
  // 実行中Workflowの枠は期限だけで解放しない。終端状態も確認する。
  const uncertain = await env.DB.prepare(
    `SELECT DISTINCT j.* FROM ai_calls c JOIN processing_jobs j ON j.id=c.job_id
    WHERE c.status='running' AND c.updated_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 minutes') LIMIT 20`,
  ).all<Job>();
  for (const job of uncertain.results) {
    try {
      const binding = job.kind.endsWith('_memory') ? env.MEMORY_WORKFLOW : env.ARTICLE_WORKFLOW;
      const state = await (await binding.get(job.id)).status();
      if (!['complete', 'errored', 'terminated'].includes(state.status)) continue;
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE ai_calls SET status='failed',retry_blocked=1 WHERE job_id=? AND status='running'",
        ).bind(job.id),
        ...jobFailureStatements(
          env,
          job,
          '前回のAI処理の結果を確認できませんでした。重複生成を防ぐため停止しました。再試行してください。',
        ),
        env.DB.prepare('DELETE FROM ai_deferrals WHERE job_id=?').bind(job.id),
      ]);
    } catch {
      /* 状態を確認できない間は枠を保持する。 */
    }
  }
  const stale = await env.DB.prepare(
    "SELECT j.*,COALESCE(a.attempts,0) AS dispatch_attempts FROM processing_jobs j LEFT JOIN job_dispatch_attempts a ON a.job_id=j.id WHERE j.status IN ('dispatched', 'running') AND j.updated_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 minutes') LIMIT 20",
  ).all<Job & { dispatch_attempts: number; updated_at: string }>();
  for (const job of stale.results) {
    const guard = {
      status: job.status,
      attempts: job.dispatch_attempts,
      updatedAt: job.updated_at,
    };
    try {
      const binding =
        job.kind === 'article' ||
        job.kind === 'cleanup' ||
        job.kind === 'question' ||
        job.kind === 'pufu'
          ? env.ARTICLE_WORKFLOW
          : env.MEMORY_WORKFLOW;
      const instance = await binding.get(job.id);
      const state = await instance.status();
      if (state.status === 'complete') {
        await deferJob(env, job, now(), '処理状態の確認後、再開を待っています。', guard);
        continue;
      }
      if (state.status === 'errored' || state.status === 'terminated') {
        if (job.kind === 'cleanup') {
          await deferJob(env, job, now(), '削除処理の再試行を待っています。', guard);
          continue;
        }
        await env.DB.batch([
          ...jobFailureStatements(
            env,
            job,
            '処理が中断されました。画面から再試行してください。',
            guard,
          ),
          env.DB.prepare(
            "UPDATE ai_calls SET status='failed',retry_blocked=1 WHERE job_id=? AND status='running' AND EXISTS (SELECT 1 FROM processing_jobs WHERE id=? AND status='failed')",
          ).bind(job.id, job.id),
        ]);
      }
    } catch {
      /* 接続失敗時には次回のCronで再確認する。 */
    }
  }
  await env.DB.batch([
    queueQuestionJobStatement(env),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()),
    env.DB.prepare('DELETE FROM oauth_states WHERE expires_at < ?').bind(now()),
    env.DB.prepare(
      "DELETE FROM idempotency_keys WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')",
    ),
    env.DB.prepare(
      "DELETE FROM processing_jobs WHERE status = 'done' AND updated_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')",
    ),
    env.DB.prepare(
      "DELETE FROM stock_usage WHERE created_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')",
    ),
    env.DB.prepare(
      "DELETE FROM ai_attempts WHERE created_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')",
    ),
    env.DB.prepare(
      "DELETE FROM ai_operations WHERE created_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days') AND NOT EXISTS (SELECT 1 FROM processing_jobs WHERE id=ai_operations.id)",
    ),
    env.DB.prepare(
      "DELETE FROM ai_calls WHERE updated_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days') AND status!='running' AND NOT EXISTS (SELECT 1 FROM processing_jobs WHERE id=ai_calls.job_id)",
    ),
    env.DB.prepare(
      'DELETE FROM ai_deferrals WHERE NOT EXISTS (SELECT 1 FROM processing_jobs WHERE id=ai_deferrals.job_id)',
    ),
    env.DB.prepare(
      'DELETE FROM job_dispatch_attempts WHERE NOT EXISTS (SELECT 1 FROM processing_jobs WHERE id=job_dispatch_attempts.job_id)',
    ),
  ]);
  await dispatchJobs(env);
}
