import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArticleWorkflow, MemoryWorkflow } from '../server/workflows';
import { testApp, mockEvent, mockStep } from './helpers';
import type { Env, Job } from '../server/env';

describe('本文取得から要約とメモリまで', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
    app.env.LOCAL_DEMO_ENABLED = 'true';
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.dispose();
  });
  async function savedArticle() {
    const response = await app.request('/api/v1/stocks', {
      method: 'POST',
      body: { project_id: 'alice-project', url: 'https://example.com/story' },
    });
    return (await response.json()) as { id: string };
  }
  function articleFetch(status = 200) {
    const original = globalThis.fetch;
    const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === 'cloudflare-dns.com')
        return new Response(
          JSON.stringify({
            Status: 0,
            Answer: url.searchParams.get('type') === 'A' ? [{ type: 1, data: '8.8.8.8' }] : [],
          }),
        );
      if (url.hostname === 'example.com')
        return new Response(
          `<html><head><title>非同期処理の設計</title></head><body><article><h1>非同期処理の設計</h1>${'<p>記事の保存受付と要約処理を分離すると、通信が切れても処理を継続できます。再試行される処理では同じ操作を重複して実行しない設計が必要です。</p>'.repeat(12)}</article></body></html>`,
          { status, headers: { 'Content-Type': 'text/html' } },
        );
      return original(input, init);
    });
    vi.stubGlobal('fetch', mock);
    return mock;
  }
  async function runArticle() {
    const job = await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE kind = 'article' ORDER BY revision DESC LIMIT 1",
    ).first<Job>();
    await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(job!.id), mockStep());
    return job!;
  }
  async function runLatestMemory(kind: string, target: string) {
    const job = await app.env.DB.prepare(
      'SELECT * FROM processing_jobs WHERE kind = ? AND target_id = ? ORDER BY revision DESC LIMIT 1',
    )
      .bind(kind, target)
      .first<Job>();
    await new MemoryWorkflow(app.ctx, app.env).run(mockEvent(job!.id), mockStep());
    return job!;
  }
  it('記事の本文・要約・根拠付きプロジェクト／ユーザーメモリを生成する', async () => {
    const { id: stockId } = await savedArticle();
    const fetchMock = articleFetch();
    const job = await runArticle();
    const article = await app.env.DB.prepare('SELECT * FROM articles WHERE id = ?')
      .bind(job.target_id)
      .first<{ status: string; summary_json: string; content_key: string }>();
    expect(article!.status).toBe('ready');
    expect(JSON.parse(article!.summary_json).keyPoints.length).toBeGreaterThan(0);
    expect(await app.env.CONTENT.get(article!.content_key)).not.toBeNull();
    const questionJob = await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE kind = 'question' AND target_id = ?",
    )
      .bind(stockId)
      .first<Job>();
    expect(questionJob).not.toBeNull();
    await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(questionJob!.id), mockStep());
    expect(
      (await app.env.DB.prepare('SELECT stock_id, status FROM questions WHERE stock_id = ?')
        .bind(stockId)
        .first())!,
    ).toMatchObject({ stock_id: stockId, status: 'ready' });
    const request = fetchMock.mock.calls.find(([value]) =>
      String(value).includes('example.com/story'),
    )!;
    expect(JSON.stringify(request[1])).not.toContain('Bearer');
    expect(JSON.stringify(request[1])).not.toContain('Cookie');
    await runLatestMemory('project_memory', 'alice-project');
    await runLatestMemory('user_memory', 'alice');
    const memories = await app.env.DB.prepare('SELECT * FROM memories').all<{
      article_count: number;
      data_json: string;
    }>();
    expect(memories.results).toHaveLength(2);
    for (const memory of memories.results) {
      expect(memory.article_count).toBe(1);
      expect(JSON.parse(memory.data_json).knowledge[0].articleIds).toEqual([job.target_id]);
    }
    const revision = await app.env.DB.prepare(
      "SELECT memory_revision FROM users WHERE id = 'alice'",
    ).first<{ memory_revision: number }>();
    await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(job.id), mockStep());
    expect(
      (await app.env.DB.prepare("SELECT memory_revision FROM users WHERE id = 'alice'").first<{
        memory_revision: number;
      }>())!.memory_revision,
    ).toBe(revision!.memory_revision);
  });
  it('複数プロジェクトの同じ記事をユーザーメモリでは1件として扱う', async () => {
    await savedArticle();
    await app.request('/api/v1/stocks', {
      method: 'POST',
      body: { project_id: 'alice-second', url: 'https://example.com/story' },
    });
    articleFetch();
    await runArticle();
    await runLatestMemory('user_memory', 'alice');
    expect(
      (await app.env.DB.prepare(
        "SELECT article_count FROM memories WHERE user_id = 'alice'",
      ).first<{ article_count: number }>())!.article_count,
    ).toBe(1);
  });
  it.each([
    {
      kind: 'user_memory',
      target: 'alice',
      bio: 'Web開発の経験があり、小さな検証を大切にしています。',
      description: 'Web開発の経験があり、小さな検証を大切にしています。',
      scope: 'user',
    },
    { kind: 'user_memory', target: 'alice', bio: '', description: '', scope: 'user' },
    {
      kind: 'project_memory',
      target: 'alice-project',
      bio: 'ユーザーの活動背景。',
      description: '信頼性の高いアプリを設計する。',
      scope: 'project',
    },
  ])('メモリ生成に渡す説明を対象ごとに選ぶ: $scope / $bio', async (testCase) => {
    await app.env.DB.prepare("UPDATE users SET bio = ? WHERE id = 'alice'")
      .bind(testCase.bio)
      .run();
    await app.env.DB.prepare(
      "UPDATE projects SET description = '信頼性の高いアプリを設計する。' WHERE id = 'alice-project'",
    ).run();
    await savedArticle();
    articleFetch();
    await runArticle();
    const run = vi.fn<NonNullable<Env['AI']>['run']>(async () => ({
      response: { interests: ['非同期処理への関心。'], knowledge: [], questions: [] },
    }));
    app.env.AI = { run };
    await runLatestMemory(testCase.kind, testCase.target);
    expect(run).toHaveBeenCalledOnce();
    expect(JSON.parse(String(run.mock.calls[0][1].messages[1].content)).context).toMatchObject({
      scope: testCase.scope,
      description: testCase.description,
    });
  });
  it('取得失敗を記録し、再試行では別のWorkflow世代を作る', async () => {
    const { id } = await savedArticle();
    articleFetch(403);
    await expect(runArticle()).rejects.toThrow();
    expect((await app.env.DB.prepare('SELECT status FROM articles').first())!.status).toBe(
      'failed',
    );
    expect((await app.request(`/api/v1/stocks/${id}/retry`, { method: 'POST' })).status).toBe(202);
    expect((await app.env.DB.prepare('SELECT generation FROM articles').first())!.generation).toBe(
      2,
    );
    articleFetch();
    await runArticle();
    expect((await app.env.DB.prepare('SELECT status FROM articles').first())!.status).toBe('ready');
  });
  it('要約生成中に増えた保存先にもメモリ更新を登録する', async () => {
    await savedArticle();
    articleFetch();
    app.env.AI = {
      run: vi.fn(async () => {
        await app.request('/api/v1/stocks', {
          method: 'POST',
          body: { project_id: 'alice-second', url: 'https://example.com/story' },
        });
        return {
          response: JSON.stringify({
            overview: '非同期処理の概要。',
            keyPoints: ['再試行に備えて冪等にする。'],
            topics: ['非同期処理'],
          }),
        };
      }),
    };
    await runArticle();
    const project = await app.env.DB.prepare(
      "SELECT memory_revision FROM projects WHERE id = 'alice-second'",
    ).first<{ memory_revision: number }>();
    expect(project!.memory_revision).toBe(2);
    expect(
      await app.env.DB.prepare(
        "SELECT id FROM processing_jobs WHERE kind = 'project_memory' AND target_id = 'alice-second' AND revision = 2",
      ).first(),
    ).not.toBeNull();
  });
  it('メモリ生成中に自己紹介が変わったら古い生成結果を公開しない', async () => {
    await savedArticle();
    articleFetch();
    await runArticle();
    app.env.LOCAL_DEMO_ENABLED = 'false';
    app.env.AI = {
      run: vi.fn(async () => {
        expect(
          (
            await app.request('/api/v1/me', {
              method: 'PATCH',
              body: { name: 'Alice', bio: '新しい活動に取り組んでいます。' },
            })
          ).status,
        ).toBe(200);
        return {
          response: JSON.stringify({
            interests: ['非同期処理を調査しています。'],
            knowledge: [],
            questions: [],
          }),
        };
      }),
    };
    const job = await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE kind = 'user_memory' ORDER BY revision DESC LIMIT 1",
    ).first<Job>();
    await new MemoryWorkflow(app.ctx, app.env).run(mockEvent(job!.id), mockStep());
    expect(
      await app.env.DB.prepare("SELECT id FROM memories WHERE user_id = 'alice'").first(),
    ).toBeNull();
    const latest = await app.env.DB.prepare(
      "SELECT revision FROM processing_jobs WHERE kind = 'user_memory' ORDER BY revision DESC LIMIT 1",
    ).first<{ revision: number }>();
    expect(latest!.revision).toBeGreaterThan(job!.revision);
  });
  it('記事削除後のメモリを空にし、本文も削除する', async () => {
    const { id } = await savedArticle();
    articleFetch();
    await runArticle();
    await runLatestMemory('user_memory', 'alice');
    const key = (await app.env.DB.prepare('SELECT content_key FROM articles').first<{
      content_key: string;
    }>())!.content_key;
    await app.request(`/api/v1/stocks/${id}`, { method: 'DELETE' });
    await runLatestMemory('user_memory', 'alice');
    const cleanup = await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE kind = 'cleanup'",
    ).first<Job>();
    await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(cleanup!.id), mockStep());
    expect(await app.env.CONTENT.get(key)).toBeNull();
    expect(
      (await app.env.DB.prepare(
        "SELECT article_count FROM memories WHERE user_id = 'alice'",
      ).first())!.article_count,
    ).toBe(0);
  });
  it('AI失敗後の再取得で旧世代の本文を残さない', async () => {
    const { id } = await savedArticle();
    articleFetch();
    app.env.AI = { run: vi.fn(async () => ({ response: 'invalid-json' })) };
    await expect(runArticle()).rejects.toThrow();
    const oldKey = (await app.env.DB.prepare('SELECT content_key FROM articles').first<{
      content_key: string;
    }>())!.content_key;
    expect(await app.env.CONTENT.get(oldKey)).not.toBeNull();
    await app.request(`/api/v1/stocks/${id}/retry`, { method: 'POST' });
    app.env.AI = undefined;
    await runArticle();
    const cleanup = await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE kind = 'cleanup' AND target_id = ?",
    )
      .bind(oldKey)
      .first<Job>();
    expect(cleanup).not.toBeNull();
    await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(cleanup!.id), mockStep());
    expect(await app.env.CONTENT.get(oldKey)).toBeNull();
  });
});
