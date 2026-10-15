import type { Env, Job } from './env';
import { now, queueQuestionJobStatement, jobFailureStatements } from './db';

export async function dispatchJobs(env: Env): Promise<void> {
  const pending = await env.DB.prepare(
    "SELECT * FROM processing_jobs WHERE status = 'pending' ORDER BY CASE kind WHEN 'article' THEN 0 WHEN 'cleanup' THEN 1 WHEN 'question' THEN 2 ELSE 3 END, created_at LIMIT 20",
  ).all<Job>();
  for (const job of pending.results) {
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
        await (await binding.get(job.id)).status();
      }
      await env.DB.prepare(
        "UPDATE processing_jobs SET status = 'dispatched', updated_at = ? WHERE id = ? AND status = 'pending'",
      )
        .bind(now(), job.id)
        .run();
    } catch {
      console.error('workflow_dispatch_pending', { jobId: job.id });
    }
  }
}
export async function scheduledMaintenance(env: Env): Promise<void> {
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
  ]);
  await dispatchJobs(env);
}
