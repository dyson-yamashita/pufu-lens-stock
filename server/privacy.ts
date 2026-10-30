import type { Env } from './env';
import { isDemo } from './env';

export async function cleanupLegacyUserMemory(env: Env): Promise<void> {
  const jobs = await env.DB.prepare('SELECT id,kind FROM privacy_cleanup_jobs LIMIT 10').all<{
    id: string;
    kind: string;
  }>();
  for (const job of jobs.results) {
    try {
      try {
        const instance = await (
          job.kind === 'pufu' ? env.ARTICLE_WORKFLOW : env.MEMORY_WORKFLOW
        ).get(job.id);
        if (isDemo(env)) {
          // Miniflareはinstance.delete未実装。本番では完了済みのステップも消去する。
          const state = await instance.status();
          if (!['complete', 'errored', 'terminated'].includes(state.status))
            await instance.terminate();
        } else await instance.delete();
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'instance.not_found') throw error;
      }
      await env.DB.batch([
        env.DB.prepare('DELETE FROM ai_calls WHERE job_id=?').bind(job.id),
        env.DB.prepare('DELETE FROM privacy_cleanup_jobs WHERE id=?').bind(job.id),
      ]);
    } catch {
      console.error('legacy_profile_cleanup_pending');
      return;
    }
  }
}
