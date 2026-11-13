import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testApp, mockStep } from './helpers';
import { meteredOperation } from '../server/ai-neurons';
import { aiStep, invokeAi } from '../server/usage';
import { dispatchJobs } from '../server/jobs';
import { embedSearchText } from '../server/search-ai';
import { syncSearchIndex } from '../server/search-index';
import { searchBindings, searchStock, searchEntry } from './search-helpers';
import type { Job } from '../server/env';
import { legalVersions } from '../shared/legal';

describe('登録完了前のAI消費防止', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp({ onboarding: false });
  });
  afterEach(async () => app.dispose());
  const register = (user = 'alice') =>
    app.env.DB.prepare('UPDATE users SET onboarding_completed_at=? WHERE id=?')
      .bind(new Date().toISOString(), user)
      .run();
  const kinds = ['article', 'question', 'pufu', 'project_memory', 'user_memory'] as const;

  it('AI接続済みの初回デモでも登録前はWorkflowを配送せず、登録後に配送する', async () => {
    app.env.LOCAL_DEMO_ENABLED = 'true';
    const run = vi.fn();
    app.env.AI = { run };
    const response = await app.request('/api/auth/demo', {
      method: 'POST',
      headers: { Cookie: '' },
    });
    expect(response.status).toBe(200);
    expect(app.env.ARTICLE_WORKFLOW.create).not.toHaveBeenCalled();
    expect(app.env.MEMORY_WORKFLOW.create).not.toHaveBeenCalled();
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    expect(
      (
        await app.request('/api/v1/onboarding', {
          method: 'POST',
          headers: { Cookie: cookie },
          body: {
            name: 'デモ利用者',
            terms_accepted: true,
            privacy_accepted: true,
            terms_version: legalVersions.terms,
            privacy_version: legalVersions.privacy,
          },
        })
      ).status,
    ).toBe(200);
    expect(app.env.ARTICLE_WORKFLOW.create).toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled(); // このfixtureのWorkflow bindingは配送のみを記録する。
  });

  it('未登録の全種類の予約を保留し、清掃・他ユーザーを配送して登録後に再開する', async () => {
    await register('bob');
    for (let index = 0; index < 25; index++)
      await app.env.DB.prepare(
        "INSERT INTO processing_jobs(id,user_id,kind,target_id,revision) VALUES (?,'alice',?,?,0)",
      )
        .bind(`waiting-${index}`, kinds[index % kinds.length], `target-${index}`)
        .run();
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO processing_jobs(id,user_id,kind,target_id,revision) VALUES ('cleanup','alice','cleanup','old-body',0),('registered','bob','article','body',0)",
      ),
    ]);
    await dispatchJobs(app.env);
    const create = vi.mocked(app.env.ARTICLE_WORKFLOW.create);
    expect(create.mock.calls.map(([options]) => options!.id).sort()).toEqual([
      'cleanup',
      'registered',
    ]);
    expect(
      await app.env.DB.prepare(
        "SELECT job_id FROM job_dispatch_attempts WHERE job_id LIKE 'waiting-%'",
      ).all(),
    ).toMatchObject({ results: [] });
    expect(
      await app.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM processing_jobs WHERE user_id='alice' AND status='pending'",
      ).first(),
    ).toEqual({ n: 25 });
    await register();
    await dispatchJobs(app.env);
    expect(create.mock.calls.some(([options]) => options!.id!.startsWith('waiting-'))).toBe(true);
  });

  it.each(kinds)(
    '予約済みの%sを再開しても登録前はAIを呼ばず、登録後は生成・計測する',
    async (kind) => {
      const job: Job = {
        id: 'reserved',
        user_id: 'alice',
        kind,
        target_id: 'target',
        revision: 0,
        status: 'running',
      };
      await app.env.DB.prepare('INSERT INTO ai_operations(id,user_id,kind) VALUES (?,?,?)')
        .bind(job.id, job.user_id, kind.endsWith('_memory') ? 'memory' : kind)
        .run();
      const response = { response: '回答', usage: { prompt_tokens: 100, completion_tokens: 10 } };
      const run = vi.fn(async () => response);
      app.env.AI = { run };
      const operation = vi.fn(async () => ({
        result: await invokeAi(app.env, { messages: [], max_tokens: 20, temperature: 0 }),
      }));
      await expect(aiStep(app.env, job, mockStep(), 'generate', operation)).rejects.toBeInstanceOf(
        Error,
      );
      expect(operation).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
      expect(await app.env.DB.prepare('SELECT id FROM ai_attempts').all()).toMatchObject({
        results: [],
      });
      await register();
      expect(await aiStep(app.env, job, mockStep(), 'generate', operation)).toEqual({
        result: response,
      });
      expect(run).toHaveBeenCalledOnce();
      expect(
        await app.env.DB.prepare('SELECT neurons_micros,usage_complete FROM ai_attempts').first(),
      ).toEqual({ neurons_micros: 1_181_830, usage_complete: 1 });
    },
  );

  it.each(['alice', 'missing'])(
    '共通AI実行処理でも未登録・不在の所有者を拒否する: %s',
    async (user) => {
      const run = vi.fn();
      app.env.AI = { run };
      await expect(
        meteredOperation(app.env, user, 'attempt', () =>
          invokeAi(app.env, { messages: [], max_tokens: 20, temperature: 0 }),
        ),
      ).rejects.toThrow('登録');
      expect(run).not.toHaveBeenCalled();
    },
  );

  it.each(['query', 'index'] as const)(
    '埋め込み%sは登録前にAIも利用枠も消費せず、登録後に実行する',
    async (kind) => {
      const { run } = searchBindings(app.env);
      await expect(embedSearchText(app.env, 'alice', '本文', kind)).rejects.toBeInstanceOf(Error);
      expect(run).not.toHaveBeenCalled();
      expect(await app.env.DB.prepare('SELECT id FROM ai_attempts').all()).toMatchObject({
        results: [],
      });
      await register();
      expect(await embedSearchText(app.env, 'alice', '本文', kind)).toHaveLength(1024);
      expect(run).toHaveBeenCalledOnce();
    },
  );

  it('未登録の索引候補が先頭に多数あっても他ユーザーを処理し、登録後に作成する', async () => {
    const bindings = searchBindings(app.env);
    for (let index = 0; index < 11; index++) await searchStock(app, `waiting-${index}`);
    await register('bob');
    await searchStock(app, 'registered', { owner: 'bob' });
    await syncSearchIndex(app.env);
    expect(bindings.run).toHaveBeenCalledOnce();
    expect([...bindings.vectors.values()].map((vector) => vector.namespace)).toEqual(['bob']);
    expect(
      await app.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM stock_search_entries WHERE user_id='alice' AND ready=0 AND touched=0 AND lease_until IS NULL",
      ).first(),
    ).toEqual({ n: 11 });
    await register();
    await syncSearchIndex(app.env);
    expect([...bindings.vectors.values()].some((vector) => vector.namespace === 'alice')).toBe(
      true,
    );
  });

  it('登録未完了でも既存の検索索引の削除は継続する', async () => {
    const bindings = searchBindings(app.env);
    await register();
    const stock = await searchStock(app, 'cleanup');
    const entry = await searchEntry(app.env, stock);
    await syncSearchIndex(app.env);
    await app.env.DB.batch([
      app.env.DB.prepare("UPDATE users SET onboarding_completed_at=NULL WHERE id='alice'"),
      app.env.DB.prepare('DELETE FROM stocks WHERE id=?').bind(stock),
    ]);
    bindings.run.mockClear();
    await syncSearchIndex(app.env);
    expect(bindings.deleteByIds).toHaveBeenCalledWith([entry]);
    expect(bindings.run).not.toHaveBeenCalled();
  });
});
