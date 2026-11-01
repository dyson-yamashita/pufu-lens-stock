import type { Env, Job } from './env';
import { isDemo } from './env';
import { getOAuthApi } from '@cloudflare/workers-oauth-provider';
import { isWorkflowInstanceNotFound } from './workflow-instance';

export async function requestAccountDeletion(env: Env, userId: string): Promise<void> {
  // 後処理のIDを確保してから、本人の全データと認証を同一トランザクションで削除する。
  await env.DB.batch([
    env.DB.prepare(
      'INSERT OR IGNORE INTO account_deletions (user_id) SELECT id FROM users WHERE id = ?',
    ).bind(userId),
    env.DB.prepare(
      'INSERT OR IGNORE INTO account_deletion_jobs (id,user_id,kind) SELECT id,user_id,kind FROM processing_jobs WHERE user_id = ?',
    ).bind(userId),
    env.DB.prepare(
      'DELETE FROM ai_deferrals WHERE job_id IN (SELECT id FROM processing_jobs WHERE user_id = ?)',
    ).bind(userId),
    env.DB.prepare(
      'DELETE FROM job_dispatch_attempts WHERE job_id IN (SELECT id FROM processing_jobs WHERE user_id = ?)',
    ).bind(userId),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);
}

export async function cleanupIfAccountDeleted(env: Env, userId: string): Promise<boolean> {
  if (await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first()) return false;
  // 退会と並行した外部保存が後から完了しても、失敗時にCronの削除対象を失わない。
  await env.DB.prepare(
    'INSERT INTO account_deletions (user_id) VALUES (?) ON CONFLICT(user_id) DO UPDATE SET generation = lower(hex(randomblob(16))), last_attempt_at = NULL',
  )
    .bind(userId)
    .run();
  await cleanupAccount(env, userId);
  return true;
}

export async function cleanupAccount(env: Env, userId: string): Promise<boolean> {
  try {
    const pending = await env.DB.prepare(
      'SELECT user_id,generation FROM account_deletions WHERE user_id = ?',
    )
      .bind(userId)
      .first<{ user_id: string; generation: string }>();
    if (!pending) return true;
    await env.DB.prepare(
      "UPDATE account_deletions SET last_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ?",
    )
      .bind(userId)
      .run();
    // 大量のデータはCronで続きを処理し、1回のリクエストの処理量を制限する。
    const jobs = await env.DB.prepare(
      'SELECT id,kind FROM account_deletion_jobs WHERE user_id = ? LIMIT 10',
    )
      .bind(userId)
      .all<Pick<Job, 'id' | 'kind'>>();
    for (const job of jobs.results) {
      const binding = job.kind.endsWith('_memory') ? env.MEMORY_WORKFLOW : env.ARTICLE_WORKFLOW;
      try {
        const instance = await binding.get(job.id);
        if (isDemo(env)) {
          // 現行Miniflareは状態削除を未実装。ローカルデモでは実行停止まで行う。
          const state = await instance.status();
          if (!['complete', 'errored', 'terminated'].includes(state.status))
            await instance.terminate();
        } else {
          await instance.delete();
        }
      } catch (error) {
        // 未起動・保持期限切れ・前回削除済みのインスタンスは削除不要。
        if (!isWorkflowInstanceNotFound(error)) throw error;
      }
      await env.DB.prepare('DELETE FROM account_deletion_jobs WHERE id = ? AND user_id = ?')
        .bind(job.id, userId)
        .run();
    }
    // 現在のDB参照にない旧世代や削除済み記事の本文も含める。
    const contents = await env.CONTENT.list({ prefix: `${userId}/`, limit: 100 });
    if (contents.objects.length)
      await env.CONTENT.delete(contents.objects.map((object) => object.key));
    if (contents.truncated) return false;
    if (env.OAUTH_KV) {
      // Cronではfetch時のOAUTH_PROVIDERがないため、SDKの公式ヘルパーを利用する。
      const unusedHandler = { fetch: () => new Response(null, { status: 404 }) };
      const oauth =
        env.OAUTH_PROVIDER ??
        getOAuthApi(
          {
            apiRoute: '/mcp',
            apiHandler: unusedHandler,
            defaultHandler: unusedHandler,
            authorizeEndpoint: '/oauth/authorize',
            tokenEndpoint: '/oauth/token',
            resourceMetadata: { resource: `${env.APP_URL}/mcp` },
          },
          env,
        );
      const grants = await oauth.listUserGrants(userId, { limit: 10 });
      for (const grant of grants.items) await oauth.revokeGrant(grant.id, userId);
      if (grants.cursor) return false;
    }
    // 並行する遅延保存が要求を更新・再作成した場合、古い掃除はその要求を消さない。
    const removed = await env.DB.prepare(
      'DELETE FROM account_deletions WHERE user_id = ? AND generation = ? AND NOT EXISTS (SELECT 1 FROM account_deletion_jobs WHERE user_id = ?) RETURNING user_id',
    )
      .bind(userId, pending.generation, userId)
      .first();
    return Boolean(removed);
  } catch {
    // 削除要求は残っているので、Cronから再試行できる。
    console.error('account_cleanup_pending');
    return false;
  }
}

export async function cleanupDeletedAccounts(env: Env): Promise<void> {
  const pending = await env.DB.prepare(
    'SELECT user_id FROM account_deletions ORDER BY last_attempt_at,created_at,user_id LIMIT 5',
  ).all<{ user_id: string }>();
  for (const account of pending.results) await cleanupAccount(env, account.user_id);
}
