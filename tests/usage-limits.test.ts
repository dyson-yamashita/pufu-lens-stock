import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdir } from 'node:fs/promises';
import { testApp, mockEvent, mockStep, applyMigration } from './helpers';
import { aiStep, AiLimitError, invokeAi } from '../server/usage';
import { dispatchJobs, scheduledMaintenance } from '../server/jobs';
import { MemoryWorkflow } from '../server/workflows';
import type { Job } from '../server/env';

describe('永続利用量制限', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp({ quotaDefaults: true });
  });
  afterEach(async () => {
    await app.dispose();
  });
  const save = (n: number, options = {}) =>
    app.request('/api/v1/stocks', {
      method: 'POST',
      body: {
        type: 'text',
        project_id: 'alice-project',
        text: `確認用の本文です。保存番号${n}`,
        note: '',
      },
      ...options,
    });
  async function question() {
    const r = await save(0);
    const { id } = (await r.json()) as { id: string };
    await app.env.DB.batch([
      app.env.DB.prepare("UPDATE articles SET status='ready', summary_json=?").bind(
        JSON.stringify({ overview: '確認', keyPoints: ['確認'], topics: ['確認'] }),
      ),
      app.env.DB.prepare(
        "UPDATE questions SET status='ready', text='どう確かめる？' WHERE stock_id=?",
      ).bind(id),
      app.env.DB.prepare("UPDATE processing_jobs SET status='done'"),
    ]);
    return `question-${id}`;
  }
  it('削除しても保存履歴が減らず、並行保存・Cookie/Bearerで200件を共有する', async () => {
    for (let i = 0; i < 199; i++) expect((await save(i)).status).toBe(202);
    const existing = await app.env.DB.prepare('SELECT id FROM stocks LIMIT 1').first<{
      id: string;
    }>();
    expect((await app.request(`/api/v1/stocks/${existing!.id}`, { method: 'DELETE' })).status).toBe(
      200,
    );
    const tokenResponse = await app.request('/api/v1/tokens', {
      method: 'POST',
      body: { name: '確認', expires_days: null },
    });
    const { token } = (await tokenResponse.json()) as { token: string };
    const results = await Promise.all([
      save(200),
      save(201, { headers: { Authorization: `Bearer ${token}`, Cookie: '' } }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([202, 429]);
    expect(results.find((r) => r.status === 429)!.headers.get('Retry-After')).toBeTruthy();
    expect(
      (await app.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM stock_usage WHERE user_id='alice'",
      ).first<{ n: number }>())!.n,
    ).toBe(200);
    expect(
      (
        await app.request('/api/v1/stocks', {
          method: 'POST',
          user: 'bob',
          body: { type: 'url', project_id: 'bob-project', url: 'https://example.com/independent' },
        })
      ).status,
    ).toBe(202);
    await app.env.DB.prepare(
      "UPDATE stock_usage SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days') WHERE user_id='alice'",
    ).run();
    expect((await save(202)).status).toBe(202);
  }, 60000);
  it('プ譜は並行要求でも同時枠を超えず、再送は二重計上しない', async () => {
    const q = await question();
    Object.assign(app.env, { AI_CONCURRENT_JOBS: '1', AI_PUFU_DAILY_LIMIT: '2' });
    const request_id = crypto.randomUUID();
    const create = (rid: string) =>
      app.request(`/api/v1/questions/${q}/pufus`, {
        method: 'POST',
        body: { task: '検証を行う', request_id: rid },
      });
    const results = await Promise.all([create(request_id), create(crypto.randomUUID())]);
    expect(results.map((r) => r.status).sort()).toEqual([202, 429]);
    const success = results.find((r) => r.status === 202)!;
    const { id } = (await success.json()) as { id: string };
    const rid = id.split('pufu-alice-')[1];
    expect((await create(rid)).status).toBe(200);
    await app.env.DB.prepare("UPDATE processing_jobs SET status='done' WHERE kind='pufu'").run();
    expect((await create(crypto.randomUUID())).status).toBe(202);
    await app.env.DB.prepare("UPDATE processing_jobs SET status='done' WHERE kind='pufu'").run();
    const blocked = await create(crypto.randomUUID());
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
  });
  it('メモリ再生成も永続枠を消費し、同じrequest_idは再利用する', async () => {
    Object.assign(app.env, { AI_MEMORY_DAILY_LIMIT: '1', AI_CONCURRENT_JOBS: '2' });
    const request_id = crypto.randomUUID();
    const rebuild = (rid: string) =>
      app.request('/api/v1/memory/rebuild', { method: 'POST', body: { request_id: rid } });
    expect((await rebuild(request_id)).status).toBe(202);
    expect((await rebuild(request_id)).status).toBe(202);
    await app.env.DB.prepare("UPDATE processing_jobs SET status='done'").run();
    expect((await rebuild(crypto.randomUUID())).status).toBe(429);
  });
  it.each(['url', 'text'] as const)(
    '重複保存とIdempotency-Keyの並行再送を数え直さない: %s',
    async (type) => {
      const body =
        type === 'url'
          ? { type, project_id: 'alice-project', url: 'https://example.com/dedupe' }
          : { type, project_id: 'alice-project', text: '重複しない確認用の本文' };
      const options = { method: 'POST', body, headers: { 'Idempotency-Key': 'same-save' } };
      const responses = await Promise.all(
        Array.from({ length: 3 }, () => app.request('/api/v1/stocks', options)),
      );
      expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 202]);
      expect(
        (await app.env.DB.prepare('SELECT COUNT(*) AS n FROM stock_usage').first<{ n: number }>())!
          .n,
      ).toBe(1);
      const { id } = (await responses[0].json()) as { id: string };
      await app.request(`/api/v1/stocks/${id}`, { method: 'DELETE' });
      expect((await app.request('/api/v1/stocks', options)).status).toBe(409);
      expect(
        (
          await app.request('/api/v1/stocks', {
            ...options,
            headers: { 'Idempotency-Key': 'new-save' },
          })
        ).status,
      ).toBe(202);
      expect(
        (await app.env.DB.prepare('SELECT COUNT(*) AS n FROM stock_usage').first<{ n: number }>())!
          .n,
      ).toBe(2);
    },
  );
  it('自動メモリ更新を上限時も保持・集約し、枠が回復したら最新の自己紹介で再開する', async () => {
    await question();
    app.env.AI_MEMORY_DAILY_LIMIT = '1';
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO ai_operations (id,user_id,kind) VALUES ('used-memory','alice','memory')",
      ),
      app.env.DB.prepare(
        "INSERT INTO processing_jobs (id,user_id,kind,target_id,revision,status) VALUES ('used-memory','alice','user_memory','alice',0,'done')",
      ),
    ]);
    const run = vi.fn(
      async (_model: string, _input: Parameters<NonNullable<typeof app.env.AI>['run']>[1]) => ({
        response: JSON.stringify({ interests: ['確認'], knowledge: [], questions: [] }),
      }),
    );
    app.env.AI = { run };
    for (const bio of ['古い自己紹介', '最新の自己紹介']) {
      expect(
        (await app.request('/api/v1/me', { method: 'PATCH', body: { name: 'Alice', bio } })).status,
      ).toBe(200);
    }
    const response = await app.request('/api/v1/memory');
    expect(await response.json()).toMatchObject({
      pending: true,
      error: expect.stringContaining('利用枠'),
    });
    expect(run).not.toHaveBeenCalled();
    const pending = await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE kind='user_memory' AND status='pending'",
    ).all<Job>();
    expect(pending.results).toHaveLength(1);
    await app.env.DB.batch([
      app.env.DB.prepare(
        "UPDATE ai_operations SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days') WHERE kind='memory'",
      ),
      app.env.DB.prepare("UPDATE ai_deferrals SET retry_at='2000-01-01T00:00:00.000Z'"),
    ]);
    await dispatchJobs(app.env);
    const job = pending.results[0];
    await new MemoryWorkflow(app.ctx, app.env).run(mockEvent(job.id), mockStep());
    expect(run).toHaveBeenCalledOnce();
    expect(JSON.parse(run.mock.calls[0][1]?.messages[1].content ?? '{}').context.description).toBe(
      '最新の自己紹介',
    );
    const result = await app.request('/api/v1/memory');
    expect(await result.json()).toMatchObject({
      pending: false,
      memory: { revision: job.revision },
    });
  });
  it('AI呼び出しの並行上限・日次上限・結果再利用をユーザーごとに強制する', async () => {
    app.env.AI = { run: vi.fn() };
    app.env.AI_CONCURRENT_CALLS = '1';
    app.env.AI_CALL_DAILY_LIMIT = '1';
    const makeJob = async (id: string, user_id = 'alice') => {
      await app.env.DB.prepare(
        "INSERT INTO processing_jobs (id,user_id,kind,target_id,revision) VALUES (?,?,'pufu','test',1)",
      )
        .bind(id, user_id)
        .run();
      return {
        id,
        user_id,
        kind: 'pufu',
        target_id: 'test',
        revision: 1,
        status: 'pending',
      } as Job;
    };
    const first = await makeJob('call-first');
    const second = await makeJob('call-second');
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const operation = vi.fn(async () => {
      started();
      await gate;
      return { text: '結果' };
    });
    const running = aiStep(app.env, first, mockStep(), 'generate', operation);
    await entered;
    await expect(aiStep(app.env, first, mockStep(), 'generate', operation)).rejects.toBeInstanceOf(
      AiLimitError,
    );
    await expect(aiStep(app.env, second, mockStep(), 'generate', operation)).rejects.toBeInstanceOf(
      AiLimitError,
    );
    const bob = await makeJob('call-bob', 'bob');
    expect(
      await aiStep(app.env, bob, mockStep(), 'generate', async () => ({ text: 'Bob' })),
    ).toEqual({ text: 'Bob' });
    release();
    expect(await running).toEqual({ text: '結果' });
    expect(await aiStep(app.env, first, mockStep(), 'generate', operation)).toEqual({
      text: '結果',
    });
    expect(operation).toHaveBeenCalledOnce();
    await expect(
      aiStep(app.env, first, mockStep(), 'other-step', operation),
    ).rejects.toBeInstanceOf(AiLimitError);
    expect(
      (await app.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM ai_attempts WHERE user_id='alice'",
      ).first<{ n: number }>())!.n,
    ).toBe(1);
  });
  it('同じAIステップの失敗再試行も課金枠に記録し、3回で停止する', async () => {
    app.env.AI = { run: vi.fn() };
    const job: Job = {
      id: 'retry-job',
      user_id: 'alice',
      kind: 'pufu',
      target_id: 'test',
      revision: 1,
      status: 'pending',
    };
    await app.env.DB.prepare(
      "INSERT INTO processing_jobs (id,user_id,kind,target_id,revision) VALUES ('retry-job','alice','pufu','test',1)",
    ).run();
    const operation = vi.fn(async () => {
      throw new Error('確認用の失敗');
    });
    for (let i = 0; i < 3; i++)
      await expect(aiStep(app.env, job, mockStep(), 'generate', operation)).rejects.toThrow(
        '確認用の失敗',
      );
    await expect(aiStep(app.env, job, mockStep(), 'generate', operation)).rejects.toThrow(
      '再試行上限',
    );
    expect(operation).toHaveBeenCalledTimes(3);
    expect(
      (await app.env.DB.prepare('SELECT COUNT(*) AS n FROM ai_attempts').first<{ n: number }>())!.n,
    ).toBe(3);
  });
  it('0012からの移行で既存保存履歴を引き継ぎ、削除後も上限を維持する', async () => {
    await app.dispose();
    const migrations = (await readdir(new URL('../migrations/', import.meta.url)))
      .filter((f) => f.endsWith('.sql') && f < '0013')
      .sort();
    app = await testApp({ migrations, usageMigration: false, quotaDefaults: true });
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO articles (id,user_id,canonical_url,source_url,title,domain) VALUES ('old','alice','https://example.com/old','https://example.com/old','以前の記事','example.com')",
      ),
      app.env.DB.prepare(
        "INSERT INTO stocks (id,user_id,project_id,article_id) VALUES ('old-stock','alice','alice-project','old')",
      ),
    ]);
    await applyMigration(app.env.DB, '0013_usage_limits.sql');
    expect(
      await app.env.DB.prepare(
        "SELECT stock_id,user_id FROM stock_usage WHERE stock_id='old-stock'",
      ).first(),
    ).toEqual({ stock_id: 'old-stock', user_id: 'alice' });
    await app.request('/api/v1/stocks/old-stock', { method: 'DELETE' });
    await app.env.DB.prepare(
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<199) INSERT INTO stock_usage (stock_id,user_id) SELECT 'history-'||i,'alice' FROM n",
    ).run();
    expect((await save(1)).status).toBe(429);
    await app.env.DB.prepare(
      "UPDATE stock_usage SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days')",
    ).run();
    expect((await save(1)).status).toBe(202);
  });
  it('応答喪失による成否不明のAI呼び出しを自動で再発行しない', async () => {
    const run = vi.fn(async () => {
      throw new Error('通信エラー');
    });
    app.env.AI = { run };
    const job: Job = {
      id: 'unknown',
      user_id: 'alice',
      kind: 'pufu',
      target_id: 'unknown',
      revision: 1,
      status: 'pending',
    };
    await app.env.DB.prepare(
      "INSERT INTO processing_jobs (id,user_id,kind,target_id,revision) VALUES ('unknown','alice','pufu','unknown',1)",
    ).run();
    const operation = () =>
      invokeAi(app.env, { messages: [], max_tokens: 1, temperature: 0 }).then(() => ({}));
    await expect(aiStep(app.env, job, mockStep(), 'generate', operation)).rejects.toThrow(
      '応答を確認',
    );
    await expect(aiStep(app.env, job, mockStep(), 'generate', operation)).rejects.toThrow(
      '再試行上限',
    );
    expect(run).toHaveBeenCalledOnce();
    expect(
      (await app.env.DB.prepare('SELECT COUNT(*) AS n FROM ai_attempts').first<{ n: number }>())!.n,
    ).toBe(1);
  });
  it('応答の永続化前に中断しても、Workflowの終端確認後に枠を回復し同じAIを再発行しない', async () => {
    const q = await question();
    app.env.AI_CONCURRENT_JOBS = '1';
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO ai_operations (id,user_id,kind) VALUES ('lost','alice','pufu')",
      ),
      app.env.DB.prepare(
        "INSERT INTO processing_jobs (id,user_id,kind,target_id,revision) VALUES ('lost','alice','pufu','lost',1)",
      ),
      app.env.DB.prepare(
        "INSERT INTO ai_calls (id,job_id,user_id,status,updated_at) VALUES ('lost:generate','lost','alice','running',strftime('%Y-%m-%dT%H:%M:%fZ','now','-11 minutes'))",
      ),
    ]);
    const create = () =>
      app.request(`/api/v1/questions/${q}/pufus`, {
        method: 'POST',
        body: { task: '確認', request_id: crypto.randomUUID() },
      });
    expect((await create()).status).toBe(429);
    await scheduledMaintenance(app.env);
    expect(
      await app.env.DB.prepare("SELECT status FROM ai_calls WHERE id='lost:generate'").first(),
    ).toEqual({ status: 'running' });
    app.env.ARTICLE_WORKFLOW.get = vi.fn(async () => ({
      status: async () => ({ status: 'complete' }),
    })) as unknown as typeof app.env.ARTICLE_WORKFLOW.get;
    await scheduledMaintenance(app.env);
    expect(
      await app.env.DB.prepare(
        "SELECT status,retry_blocked FROM ai_calls WHERE id='lost:generate'",
      ).first(),
    ).toEqual({ status: 'failed', retry_blocked: 1 });
    expect((await create()).status).toBe(202);
    const job = await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE id='lost'",
    ).first<Job>();
    app.env.AI = { run: vi.fn() };
    const operation = vi.fn(async () => ({}));
    await expect(aiStep(app.env, job!, mockStep(), 'generate', operation)).rejects.toThrow(
      '再試行上限',
    );
    expect(operation).not.toHaveBeenCalled();
  });
  it('Workflow起動直後の保留をdispatchedで上書きせず、並行dispatcherも二重起動しない', async () => {
    await app.env.DB.prepare(
      "INSERT INTO processing_jobs (id,user_id,kind,target_id,revision) VALUES ('dispatch-race','alice','user_memory','alice',0)",
    ).run();
    const create = vi.fn(async () => {
      await app.env.DB.batch([
        app.env.DB.prepare("UPDATE processing_jobs SET status='pending' WHERE id='dispatch-race'"),
        app.env.DB.prepare(
          "INSERT INTO ai_deferrals (job_id,retry_at) VALUES ('dispatch-race',strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day')) ON CONFLICT(job_id) DO UPDATE SET retry_at=excluded.retry_at",
        ),
      ]);
      return { id: 'dispatch-race' };
    });
    app.env.MEMORY_WORKFLOW.create = create as unknown as typeof app.env.MEMORY_WORKFLOW.create;
    await Promise.all([dispatchJobs(app.env), dispatchJobs(app.env)]);
    expect(
      await app.env.DB.prepare(
        "SELECT status FROM processing_jobs WHERE id='dispatch-race'",
      ).first(),
    ).toEqual({ status: 'pending' });
    expect(create).toHaveBeenCalledOnce();
  });
  it('メモリの並行受付と同じIDの並行再送を区別し、ユーザー間で枠を共有しない', async () => {
    app.env.AI_MEMORY_DAILY_LIMIT = '1';
    const request_id = crypto.randomUUID();
    const rebuild = (rid: string, user = 'alice') =>
      app.request('/api/v1/memory/rebuild', { method: 'POST', user, body: { request_id: rid } });
    const responses = await Promise.all([
      rebuild(request_id),
      rebuild(request_id),
      rebuild(crypto.randomUUID()),
    ]);
    // 同じIDが先に受付されたら202が2件、別のIDが先なら429が2件となる。
    const requests = await app.env.DB.prepare(
      "SELECT id FROM memory_requests WHERE user_id='alice'",
    ).all();
    expect(requests.results).toHaveLength(1);
    expect(responses.filter((r) => r.status === 202).length).toBeGreaterThan(0);
    expect(responses.every((r) => [202, 429].includes(r.status))).toBe(true);
    expect(
      (await app.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM ai_operations WHERE user_id='alice'",
      ).first<{ n: number }>())!.n,
    ).toBe(1);
    expect((await rebuild(crypto.randomUUID(), 'bob')).status).toBe(202);
  });
  it('プロジェクトのメモリ再生成で2件分を確保できなければ受付全体を取り消す', async () => {
    app.env.AI_CONCURRENT_JOBS = '1';
    const response = await app.request('/api/v1/memory/rebuild', {
      method: 'POST',
      body: { project_id: 'alice-project', request_id: crypto.randomUUID() },
    });
    expect(response.status).toBe(429);
    for (const table of ['ai_operations', 'memory_requests', 'processing_jobs']) {
      expect(
        (await app.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n,
      ).toBe(0);
    }
  });
});
