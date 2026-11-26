import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  cleanupMemoryHistory,
  queueHistoryCleanup,
  saveMemoryWithHistory,
  type MemorySaveInput,
} from '../server/features/memory/memory-history';
import { scheduledMaintenance } from '../server/infrastructure/jobs/jobs';
import { testApp } from './helpers';

let app: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  app = await testApp();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.dispose();
});

const memoryInput = (projectId: string | null, revision: number): MemorySaveInput => ({
  userId: 'alice',
  projectId,
  revision,
  text: `版${revision}`,
  dataJson: JSON.stringify({ interests: [], knowledge: [], questions: [] }),
  articleCount: 1,
  model: 'test-model',
  contextHash: 'context',
  language: 'ja',
});

function replaceHistoryMethod<K extends 'put' | 'list'>(key: K, value: R2Bucket[K]) {
  const bucket = app.env.MEMORY_HISTORY;
  app.env.MEMORY_HISTORY = new Proxy(bucket, {
    get(target, property) {
      if (property === key) return value;
      const original = Reflect.get(target, property, target);
      return typeof original === 'function' ? original.bind(target) : original;
    },
  });
  return bucket;
}

it.each(['user', 'project'] as const)(
  'B08 %sのR2保存中に世代が進んだらD1の本文・根拠・公開履歴を進めない',
  async (scope) => {
    const projectId = scope === 'project' ? 'alice-project' : null;
    const id = projectId ? `project-${projectId}` : 'user-alice';
    const ownerSql = projectId
      ? "UPDATE projects SET memory_revision=? WHERE id='alice-project'"
      : "UPDATE users SET memory_revision=? WHERE id='alice'";
    await saveMemoryWithHistory(app.env, memoryInput(projectId, 0), []);
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO articles(id,user_id,canonical_url,source_url,title,domain,status) VALUES('source','alice','https://example.com/source','https://example.com/source','根拠','example.com','ready')",
      ),
      app.env.DB.prepare(
        "INSERT INTO memory_sources(memory_id,article_id,source_hash) VALUES(?,'source','original')",
      ).bind(id),
      app.env.DB.prepare(ownerSql).bind(1),
    ]);
    const bucket = app.env.MEMORY_HISTORY;
    let attemptedKey: string | undefined;
    replaceHistoryMethod('put', async (...args: Parameters<R2Bucket['put']>) => {
      attemptedKey = args[0];
      const result = await bucket.put(...args);
      await app.env.DB.prepare(ownerSql).bind(2).run();
      return result;
    });

    await saveMemoryWithHistory(app.env, memoryInput(projectId, 1), []);

    expect(
      await app.env.DB.prepare('SELECT revision,text FROM memories WHERE id=?').bind(id).first(),
    ).toEqual({ revision: 0, text: '版0' });
    expect(
      (await app.env.DB.prepare('SELECT article_id,source_hash FROM memory_sources').all()).results,
    ).toEqual([{ article_id: 'source', source_hash: 'original' }]);
    expect(
      (await app.env.DB.prepare('SELECT revision FROM memory_versions').all()).results,
    ).toEqual([{ revision: 0 }]);
    // The acknowledged PUT is discarded after the database rejects the stale revision.
    expect(attemptedKey).toBeDefined();
    expect(await bucket.get(attemptedKey!)).toBeNull();
    expect(
      await app.env.DB.prepare('SELECT content_key FROM memory_history_writes').first(),
    ).toBeNull();
  },
);

it.each(['timestamp', 'attempts'] as const)(
  'B08 保守の状態照会中に%sが変わったジョブを古いleaseで保留へ戻さない',
  async (changed) => {
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO processing_jobs(id,user_id,kind,target_id,revision,status,updated_at) VALUES('lease-race','alice','user_memory','alice',0,'running',strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 minutes'))",
      ),
      app.env.DB.prepare(
        "INSERT INTO job_dispatch_attempts(job_id,attempts) VALUES('lease-race',1)",
      ),
    ]);
    const refreshedAt = '2099-01-01T00:00:00.000Z';
    app.env.MEMORY_WORKFLOW.get = vi.fn(async () => ({
      status: async () => {
        await app.env.DB.prepare(
          changed === 'timestamp'
            ? "UPDATE processing_jobs SET updated_at=? WHERE id='lease-race'"
            : "UPDATE job_dispatch_attempts SET attempts=? WHERE job_id='lease-race'",
        )
          .bind(changed === 'timestamp' ? refreshedAt : 2)
          .run();
        return { status: 'complete' };
      },
    })) as unknown as typeof app.env.MEMORY_WORKFLOW.get;

    await scheduledMaintenance(app.env);

    expect(
      await app.env.DB.prepare("SELECT status FROM processing_jobs WHERE id='lease-race'").first(
        'status',
      ),
    ).toBe('running');
    expect(await app.env.DB.prepare('SELECT * FROM ai_deferrals').first()).toBeNull();
    if (changed === 'timestamp')
      expect(
        await app.env.DB.prepare(
          "SELECT updated_at FROM processing_jobs WHERE id='lease-race'",
        ).first('updated_at'),
      ).toBe(refreshedAt);
    else
      expect(
        await app.env.DB.prepare('SELECT attempts FROM job_dispatch_attempts').first('attempts'),
      ).toBe(2);
    expect(app.env.MEMORY_WORKFLOW.create).not.toHaveBeenCalled();
  },
);

it('B10 履歴掃除のlist後に再作成した世代を古い掃除が消さず次回に回収する', async () => {
  const prefix = 'alice/project-deleted/';
  const bucket = app.env.MEMORY_HISTORY;
  await bucket.put('bob/project-bob-project/1.json', '{}');
  await queueHistoryCleanup(app.env, prefix).run();
  const generation = await app.env.DB.prepare(
    'SELECT generation FROM memory_history_cleanup',
  ).first('generation');
  replaceHistoryMethod('list', async (...args: Parameters<R2Bucket['list']>) => {
    const page = await bucket.list(...args);
    await bucket.put(`${prefix}late.json`, '{}');
    await queueHistoryCleanup(app.env, prefix).run();
    return page;
  });

  await cleanupMemoryHistory(app.env);

  expect(
    await app.env.DB.prepare('SELECT generation FROM memory_history_cleanup').first('generation'),
  ).not.toBe(generation);
  expect(await bucket.get(`${prefix}late.json`)).not.toBeNull();
  app.env.MEMORY_HISTORY = bucket;
  await cleanupMemoryHistory(app.env);
  expect(await app.env.DB.prepare('SELECT * FROM memory_history_cleanup').first()).toBeNull();
  expect(await bucket.get(`${prefix}late.json`)).toBeNull();
  expect(await bucket.get('bob/project-bob-project/1.json')).not.toBeNull();
});

it('B10 退会完了後の遅いPUTとworker停止をcascade外のintentから再掃除する', async () => {
  const bucket = app.env.MEMORY_HISTORY;
  await bucket.put('bob/user-bob/1.json', '{}');
  replaceHistoryMethod('put', async (...args: Parameters<R2Bucket['put']>) => {
    expect((await app.request('/api/v1/me', { method: 'DELETE' })).status).toBe(200);
    // An earlier retry runs before the provider-side PUT completes.
    await cleanupMemoryHistory(app.env);
    await bucket.put(...args);
    throw new Error('worker stopped after provider PUT');
  });

  await expect(saveMemoryWithHistory(app.env, memoryInput(null, 0), [])).rejects.toThrow(
    'worker stopped after provider PUT',
  );

  expect(await app.env.DB.prepare('SELECT * FROM account_deletions').first()).toBeNull();
  expect(await app.env.DB.prepare('SELECT * FROM memory_versions').first()).toBeNull();
  const pending = await app.env.DB.prepare('SELECT content_key FROM memory_history_writes').first<{
    content_key: string;
  }>();
  expect(pending?.content_key).toContain('alice/user-alice/');
  expect(await bucket.get(pending!.content_key)).not.toBeNull();
  await cleanupMemoryHistory(app.env);
  expect(await bucket.get(pending!.content_key)).toBeNull();
  expect(await app.env.DB.prepare('SELECT * FROM memory_history_writes').first()).not.toBeNull();
  expect(await bucket.get('bob/user-bob/1.json')).not.toBeNull();
  expect((await app.request('/api/v1/me')).status).toBe(401);
});
