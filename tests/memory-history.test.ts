import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { testApp, mockEvent, mockStep } from './helpers';
import { MemoryWorkflow } from '../server/workflows';
import {
  saveMemoryWithHistory,
  cleanupMemoryHistory,
  type MemorySaveInput,
} from '../server/memory-history';
import { cleanupAccount, requestAccountDeletion } from '../server/account';
import type { MemoryVersionList } from '../shared/domain';

let app: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  app = await testApp();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.dispose();
});
function overrideBucket(method: string, replacement: unknown) {
  const bucket = app.env.MEMORY_HISTORY;
  app.env.MEMORY_HISTORY = new Proxy(bucket, {
    get(target, property) {
      if (property === method) return replacement;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return () => {
    app.env.MEMORY_HISTORY = bucket;
  };
}
const input = (revision: number, projectId: string | null = 'alice-project'): MemorySaveInput => ({
  userId: 'alice',
  projectId,
  revision,
  text: `第${revision}版の本文`,
  dataJson: JSON.stringify({
    interests: [`関心${revision}`],
    knowledge: [],
    questions: [`問い${revision}`],
  }),
  articleCount: revision + 1,
  model: 'test-model',
  contextHash: 'context',
  language: 'ja',
});
async function save(revision: number, projectId: string | null = 'alice-project') {
  await app.env.DB.prepare(
    projectId
      ? 'UPDATE projects SET memory_revision=? WHERE id=?'
      : 'UPDATE users SET memory_revision=? WHERE id=?',
  )
    .bind(revision, projectId ?? 'alice')
    .run();
  await saveMemoryWithHistory(app.env, input(revision, projectId), []);
}
const path = (suffix = '', project = 'alice-project') =>
  `/api/v1/memory/history${suffix}?project_id=${project}`;

it('R2に各版を保存し、一覧は本文や内部キーを返さず、過去版取得でAIを呼ばない', async () => {
  await save(1);
  await save(2);
  const list = (await (await app.request(path())).json()) as MemoryVersionList;
  expect(list.versions.map((v) => v.revision)).toEqual([2, 1]);
  expect(JSON.stringify(list)).not.toMatch(/content_key|第1版の本文|data_json|alice\//);
  expect((await app.env.MEMORY_HISTORY.list()).objects).toHaveLength(2);
  const first = await (await app.request(path('/1'))).json();
  expect(first).toMatchObject({
    version: { revision: 1, text: '第1版の本文', data: { interests: ['関心1'] } },
  });
  expect(await app.env.DB.prepare('SELECT text FROM memories').first('text')).toBe('第2版の本文');
  expect(app.env.MEMORY_WORKFLOW.create).not.toHaveBeenCalled();
  await saveMemoryWithHistory(app.env, { ...input(2), text: '再実行で上書きしない' }, []);
  expect((await (await app.request(path('/2'))).json()) as object).toMatchObject({
    version: { text: '第2版の本文' },
  });
});

it('プロジェクト・利用者全体の履歴を分離し、所有者・匿名・トークンの権限を確認する', async () => {
  await save(1);
  await save(2, null);
  expect(await (await app.request('/api/v1/memory/history')).json()).toMatchObject({
    versions: [{ revision: 2 }],
  });
  expect((await app.request(path('/1'), { user: 'bob' })).status).toBe(404);
  expect((await app.request(path('', 'missing'))).status).toBe(404);
  expect((await app.request(path('/999'))).status).toBe(404);
  for (const value of ['-1', 'no', '1.5'])
    expect((await app.request(path(`/${value}`))).status).toBe(400);
  expect((await app.request(`${path()}&before=no`)).status).toBe(400);
  const anonymous = await app.request(path('/1'), { user: 'nobody' });
  expect(anonymous.status).toBe(401);
});

it('25件以上の履歴を安定した版番号カーソルで重複なく取得する', async () => {
  for (let revision = 0; revision < 26; revision++) await save(revision);
  const first = (await (await app.request(path())).json()) as MemoryVersionList;
  expect(first.versions).toHaveLength(24);
  expect(first).toMatchObject({ has_more: true, next_before: 2 });
  const next = (await (
    await app.request(`${path()}&before=${first.next_before}`)
  ).json()) as MemoryVersionList;
  expect(next.versions.map((v) => v.revision)).toEqual([1, 0]);
  expect(next).toMatchObject({ has_more: false, next_before: null });
});

it('保存開始前の既存メモリも次回更新で保全し、古いジョブの結果は履歴に公開しない', async () => {
  await app.env.DB.prepare(
    "INSERT INTO memories(id,user_id,project_id,revision,text,data_json,article_count,model) VALUES('project-alice-project','alice','alice-project',0,'以前の内容',?,1,'old')",
  )
    .bind(input(0).dataJson)
    .run();
  await save(1);
  expect(await (await app.request(path('/0'))).json()).toMatchObject({
    version: { text: '以前の内容' },
  });
  await saveMemoryWithHistory(app.env, input(0), []);
  expect(await app.env.DB.prepare('SELECT revision FROM memories').first('revision')).toBe(1);
  expect((await app.env.MEMORY_HISTORY.list()).objects).toHaveLength(2);
});

it('R2書き込み失敗では最新メモリも履歴一覧も進めず、再試行で保存する', async () => {
  await save(1);
  const restore = overrideBucket('put', async () => {
    throw new Error('R2 unavailable');
  });
  await expect(save(2)).rejects.toThrow('R2 unavailable');
  expect(await app.env.DB.prepare('SELECT revision FROM memories').first('revision')).toBe(1);
  expect((await (await app.request(path())).json()) as object).toMatchObject({
    versions: [{ revision: 1 }],
  });
  restore();
  await save(2);
  expect((await app.env.MEMORY_HISTORY.list()).objects).toHaveLength(2);
  expect((await app.request(path('/2'))).status).toBe(200);
});

it('実際のMemoryWorkflowが生成したメモリをR2履歴に残す', async () => {
  await app.env.DB.prepare(
    "INSERT INTO processing_jobs(id,user_id,kind,target_id,revision) VALUES('memory-first','alice','project_memory','alice-project',0)",
  ).run();
  await new MemoryWorkflow(app.ctx, app.env).run(mockEvent('memory-first'), mockStep());
  expect(await (await app.request(path('/0'))).json()).toMatchObject({
    version: { revision: 0, data: { interests: [], knowledge: [], questions: [] } },
  });
});

it('削除中に遅れてR2保存が完了しても掃除要求を再作成し、別利用者を消さない', async () => {
  const originalPut = app.env.MEMORY_HISTORY.put.bind(app.env.MEMORY_HISTORY);
  overrideBucket('put', async (...args: Parameters<R2Bucket['put']>) => {
    const result = await originalPut(...args);
    await app.request('/api/v1/projects/alice-project', { method: 'DELETE' });
    await cleanupMemoryHistory(app.env);
    return result;
  });
  await save(1);
  await app.env.MEMORY_HISTORY.put('bob/project-bob-project/1.json', '{}');
  await cleanupMemoryHistory(app.env);
  expect((await app.env.MEMORY_HISTORY.list()).objects.map((o) => o.key)).toEqual([
    'bob/project-bob-project/1.json',
  ]);
  expect(await app.env.DB.prepare('SELECT revision FROM memory_versions').first()).toBeNull();
});

it('プロジェクト削除と退会でR2履歴を消し、削除失敗は次の掃除で回復する', async () => {
  await save(1);
  await save(1, null);
  await app.request('/api/v1/projects/alice-project', { method: 'DELETE' });
  expect((await app.request(path('/1'))).status).toBe(404);
  const restore = overrideBucket(
    'delete',
    vi
      .fn()
      .mockRejectedValueOnce(new Error('retry'))
      .mockImplementation(app.env.MEMORY_HISTORY.delete.bind(app.env.MEMORY_HISTORY)),
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await cleanupMemoryHistory(app.env);
  expect(
    await app.env.DB.prepare('SELECT prefix FROM memory_history_cleanup').first(),
  ).not.toBeNull();
  await cleanupMemoryHistory(app.env);
  expect((await app.env.MEMORY_HISTORY.list()).objects).toHaveLength(1);
  restore();
  app.env.MEMORY_WORKFLOW.get = vi.fn(async () => {
    throw new Error('instance.not_found');
  });
  await requestAccountDeletion(app.env, 'alice');
  await cleanupAccount(app.env, 'alice');
  expect((await app.env.MEMORY_HISTORY.list({ prefix: 'alice/' })).objects).toHaveLength(0);
  expect(await app.env.DB.prepare('SELECT revision FROM memory_versions').first()).toBeNull();
});

it.each(['writer-stopped', 'd1-failed'])(
  '削除sweepより遅いPUTと%sの組合せも永続intentから回収する',
  async (failure) => {
    const bucket = app.env.MEMORY_HISTORY;
    const originalPut = bucket.put.bind(bucket);
    const db = app.env.DB;
    overrideBucket('put', async (...args: Parameters<R2Bucket['put']>) => {
      await app.request('/api/v1/projects/alice-project', { method: 'DELETE' });
      await cleanupMemoryHistory(app.env);
      const result = await originalPut(...args);
      if (failure === 'writer-stopped') throw new Error('writer stopped after provider PUT');
      app.env.DB = new Proxy(db, {
        get(target, property) {
          if (property === 'batch')
            return async () => {
              throw new Error('D1 temporarily unavailable');
            };
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      return result;
    });
    await expect(save(1)).rejects.toThrow();
    app.env.DB = db;
    app.env.MEMORY_HISTORY = bucket;
    expect((await bucket.list()).objects).toHaveLength(1);
    await cleanupMemoryHistory(app.env);
    expect((await bucket.list()).objects).toHaveLength(0);
    // An unresolved intent must also catch a PUT that finishes after an earlier retry.
    await originalPut('alice/project-alice-project/1.json', '{}');
    await cleanupMemoryHistory(app.env);
    expect((await bucket.list()).objects).toHaveLength(0);
    expect(await db.prepare('SELECT revision FROM memory_versions').first()).toBeNull();
  },
);

it('同じ版の再試行が成功しても先行する未確認PUTのintentを消さない', async () => {
  const bucket = app.env.MEMORY_HISTORY;
  const originalPut = bucket.put.bind(bucket);
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  overrideBucket('put', async (...args: Parameters<R2Bucket['put']>) => {
    entered();
    await gate;
    await originalPut(...args);
    throw new Error('first writer lost acknowledgement');
  });
  const first = save(1);
  const rejected = expect(first).rejects.toThrow('lost acknowledgement');
  await started;
  app.env.MEMORY_HISTORY = bucket;
  await saveMemoryWithHistory(app.env, input(1), []);
  expect(
    (await app.env.DB.prepare('SELECT id FROM memory_history_writes').all()).results,
  ).toHaveLength(1);
  await app.request('/api/v1/projects/alice-project', { method: 'DELETE' });
  await cleanupMemoryHistory(app.env);
  release();
  await rejected;
  expect((await bucket.list()).objects).toHaveLength(1);
  await cleanupMemoryHistory(app.env);
  expect((await bucket.list()).objects).toHaveLength(0);
});
