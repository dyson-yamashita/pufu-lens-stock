import type { Env, Job } from './env';
import { admitJob, retryAt } from './usage';
import { now, queueQuestionJobStatement, jobFailureStatements } from './db';

export async function dispatchJobs(env: Env): Promise<void> {
  // 未開始の古い世代だけを集約する。最新の要求は上限時もpendingのまま残す。
  await env.DB.prepare(
    `UPDATE processing_jobs SET status='done', updated_at=? WHERE status='pending'
    AND ((kind='user_memory' AND revision < (SELECT memory_revision FROM users WHERE id=target_id))
      OR (kind='project_memory' AND revision < (SELECT memory_revision FROM projects WHERE id=target_id)))`,
  )
    .bind(now())
    .run();
  const pending = await env.DB.prepare(
    "SELECT * FROM processing_jobs WHERE status = 'pending' AND NOT EXISTS (SELECT 1 FROM ai_deferrals d WHERE d.job_id=processing_jobs.id AND d.retry_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) ORDER BY CASE kind WHEN 'article' THEN 0 WHEN 'cleanup' THEN 1 WHEN 'question' THEN 2 ELSE 3 END, created_at LIMIT 20",
  ).all<Job>();
  for (const job of pending.results) {
    if (!(await admitJob(env, job))) {
      const at = await retryAt(env, job.user_id, job.kind);
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO ai_deferrals (job_id,retry_at) VALUES (?,?) ON CONFLICT(job_id) DO UPDATE SET retry_at=excluded.retry_at',
        ).bind(job.id, at),
        env.DB.prepare("UPDATE processing_jobs SET error=? WHERE id=? AND status='pending'").bind(
          `AI処理の利用枠の回復を待っています。再試行目安: ${at}`,
          job.id,
        ),
      ]);
      continue;
    }
    // Workflow起動前に取得権を確定する。起動直後のpending/doneを上書きしない。
    const claimed = await env.DB.prepare(
      "UPDATE processing_jobs SET status='dispatched',updated_at=? WHERE id=? AND status='pending' AND NOT EXISTS (SELECT 1 FROM ai_deferrals d WHERE d.job_id=processing_jobs.id AND d.retry_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) RETURNING id",
    )
      .bind(now(), job.id)
      .first();
    if (!claimed) continue;
    const binding =
      job.kind === 'article' ||
      job.kind === 'cleanup' ||
      job.kind === 'question' ||
      job.kind === 'pufu'
        ? env.ARTICLE_WORKFLOW
        : env.MEMORY_WORKFLOW;
    try {
      try {
        await binding.create({ id: job.id, params: { jobId: job.id } });
      } catch {
        const existing = await binding.get(job.id);
        const state = await existing.status();
        if (['complete', 'errored', 'terminated'].includes(state.status)) await existing.restart();
      }
    } catch {
      await env.DB.prepare(
        "UPDATE processing_jobs SET status='pending' WHERE id=? AND status='dispatched'",
      )
        .bind(job.id)
        .run();
      console.error('workflow_dispatch_pending', { jobId: job.id });
    }
  }
}
export async function scheduledMaintenance(env: Env): Promise<void> {
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
    "SELECT * FROM processing_jobs WHERE (status IN ('dispatched', 'running') OR (kind = 'cleanup' AND status = 'failed')) AND updated_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 minutes') LIMIT 20",
  ).all<Job>();
  for (const job of stale.results) {
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
        await env.DB.prepare(
          "UPDATE processing_jobs SET status='pending',updated_at=? WHERE id=? AND status IN ('dispatched','running')",
        )
          .bind(now(), job.id)
          .run();
        continue;
      }
      if (state.status === 'errored' || state.status === 'terminated') {
        if (job.kind === 'cleanup') {
          await instance.restart();
          await env.DB.prepare(
            "UPDATE processing_jobs SET status = 'dispatched', error = NULL, updated_at = ? WHERE id = ? AND status != 'done'",
          )
            .bind(now(), job.id)
            .run();
          continue;
        }
        await env.DB.prepare(
          "UPDATE ai_calls SET status='failed',retry_blocked=1 WHERE job_id=? AND status='running'",
        )
          .bind(job.id)
          .run();
        await env.DB.batch(
          jobFailureStatements(env, job, '処理が中断されました。画面から再試行してください。'),
        );
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
  ]);
  await dispatchJobs(env);
}
