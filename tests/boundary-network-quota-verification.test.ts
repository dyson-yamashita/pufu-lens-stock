import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env, Job } from '../server/env';
import { fetchPublic } from '../server/features/stocks/ingest';
import { aiStep, AiLimitError, invokeAi } from '../server/features/usage/usage';
import { saveAiUsage } from '../server/infrastructure/ai/ai-neurons';
import { ArticleWorkflow } from '../server/infrastructure/jobs/workflows';
import { mockEvent, mockStep, testApp } from './helpers';

function destination(input: RequestInfo | URL) {
  return new URL(input instanceof Request ? input.url : String(input));
}
function publicDns(url: URL) {
  return Response.json({
    Status: 0,
    Answer: url.searchParams.get('type') === 'A' ? [{ type: 1, data: '8.8.8.8' }] : [],
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('B09 外部取得の各リダイレクト境界', () => {
  it.each([
    'file:///private/article',
    'https://user:secret@second.com/article',
    'https://second.com:8080/article',
    'http://server.internal/article',
    'https://second.com/article',
  ])('移動先のURLまたはDNSを拒否すると次のHTTP取得を開始しない: %s', async (next) => {
    const fetched: string[] = [];
    const resolved: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = destination(input);
        if (url.hostname === 'cloudflare-dns.com') {
          const host = url.searchParams.get('name')!;
          resolved.push(host);
          if (host === 'second.com')
            return Response.json({
              Status: 0,
              Answer: [
                { type: 1, data: '8.8.8.8' },
                { type: 28, data: 'fd00::1' },
              ],
            });
          return publicDns(url);
        }
        expect(init?.redirect).toBe('manual');
        expect(new Headers(init?.headers).get('Cookie')).toBeNull();
        expect(new Headers(init?.headers).get('Authorization')).toBeNull();
        fetched.push(url.href);
        return new Response(null, { status: 302, headers: { Location: next } });
      }),
    );
    await expect(fetchPublic('https://example.com/start')).rejects.toThrow();
    expect(fetched).toEqual(['https://example.com/start']);
    expect(resolved.filter((host) => host === 'second.com')).toHaveLength(
      next === 'https://second.com/article' ? 2 : 0,
    );
  });

  it('公開先への相対移動も毎回DNSを確認して取得し、6回目の移動で停止する', async () => {
    const trace: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = destination(input);
        if (url.hostname === 'cloudflare-dns.com') {
          trace.push(`dns:${url.searchParams.get('type')}`);
          return publicDns(url);
        }
        expect(init?.redirect).toBe('manual');
        trace.push(`fetch:${url.pathname}`);
        return new Response(null, {
          status: 302,
          headers: { Location: `/hop-${Number(url.pathname.split('-')[1]) + 1}` },
        });
      }),
    );
    await expect(fetchPublic('https://example.com/hop-0')).rejects.toThrow('リダイレクト');
    expect(trace).toEqual(
      Array.from({ length: 6 }, (_, hop) => ['dns:A', 'dns:AAAA', `fetch:/hop-${hop}`]).flat(),
    );
  });

  it.each(['empty', 'dns-status', 'dns-http', 'deadline'])(
    '%sでは最初のHTTP取得も開始しない',
    async (failure) => {
      const http = vi.fn();
      const dns = vi.fn((url: URL) =>
        Response.json(
          {
            Status: failure === 'dns-status' ? 2 : 0,
            Answer:
              failure !== 'empty' && url.searchParams.get('type') === 'A'
                ? [{ type: 1, data: '8.8.8.8' }]
                : [],
          },
          { status: failure === 'dns-http' ? 503 : 200 },
        ),
      );
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = destination(input);
          if (url.hostname !== 'cloudflare-dns.com') {
            http();
            return new Response('unexpected');
          }
          return dns(url);
        }),
      );
      await expect(
        fetchPublic(
          'https://example.com/article',
          undefined,
          failure === 'deadline' ? Date.now() : undefined,
        ),
      ).rejects.toThrow();
      expect(http).not.toHaveBeenCalled();
      if (failure === 'deadline') expect(dns).not.toHaveBeenCalled();
      else expect(dns).toHaveBeenCalledTimes(2);
    },
  );
});

describe('B09/B11 API・Workflowと永続DBの照合', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
  });
  afterEach(async () => {
    await app.dispose();
  });

  async function articleJob() {
    const response = await app.request('/api/v1/stocks', {
      method: 'POST',
      body: { type: 'text', project_id: 'alice-project', text: '境界検証用の記事本文です。' },
    });
    expect(response.status).toBe(202);
    return (await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE kind='article'",
    ).first<Job>())!;
  }

  it('OG画像の移動先が内部DNSなら画像を保存せず記事の処理を完了する', async () => {
    app.env.LOCAL_DEMO_ENABLED = 'true';
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = destination(input);
        if (url.hostname === 'cloudflare-dns.com') {
          if (url.searchParams.get('name') === 'image.second.com')
            return Response.json({ Status: 0, Answer: [{ type: 1, data: '10.0.0.1' }] });
          return publicDns(url);
        }
        fetched.push(url.href);
        if (url.pathname === '/cover.png')
          return new Response(null, {
            status: 302,
            headers: { Location: 'https://image.second.com/private.png' },
          });
        return new Response(
          `<html><head><title>境界検証</title><meta property="og:image" content="/cover.png"></head><body><article><p>${'公開記事の本文を確認します。'.repeat(40)}</p></article></body></html>`,
          { headers: { 'Content-Type': 'text/html' } },
        );
      }),
    );
    const saved = await app.request('/api/v1/stocks', {
      method: 'POST',
      body: { project_id: 'alice-project', url: 'https://example.com/story' },
    });
    expect(saved.status).toBe(202);
    const { id } = (await saved.json()) as { id: string };
    const job = await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE kind='article'",
    ).first<Job>();
    await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(job!.id), mockStep());
    expect(fetched).toEqual(['https://example.com/story', 'https://example.com/cover.png']);
    expect(await (await app.request(`/api/v1/stocks/${id}`)).json()).toMatchObject({
      stock: { status: 'ready', has_og_image: 0 },
    });
    expect((await app.request(`/api/v1/stocks/${id}/og-image`)).status).toBe(404);
    expect((await app.env.CONTENT.list()).objects.map((object) => object.key)).toHaveLength(1);
  });

  it('操作枠の24時間境界ちょうど・別owner・別categoryの履歴を数えない', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const boundary = new Date(now - 86_400_000).toISOString();
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO ai_operations(id,user_id,kind,created_at) VALUES ('boundary','alice','memory',?),('other-owner','bob','memory',?),('other-kind','alice','pufu',?)",
      ).bind(boundary, new Date(now).toISOString(), new Date(now).toISOString()),
    ]);
    app.env.AI_MEMORY_DAILY_LIMIT = '1';
    const rebuild = () =>
      app.request('/api/v1/memory/rebuild', {
        method: 'POST',
        body: { request_id: crypto.randomUUID() },
      });
    expect((await rebuild()).status).toBe(202);
    const snapshot = () =>
      app.env.DB.prepare(
        "SELECT memory_revision, (SELECT COUNT(*) FROM memory_requests WHERE user_id='alice') AS requests, (SELECT COUNT(*) FROM processing_jobs WHERE user_id='alice') AS jobs FROM users WHERE id='alice'",
      ).first();
    const beforeRejection = await snapshot();
    expect((await rebuild()).status).toBe(429);
    expect(await snapshot()).toEqual(beforeRejection);
    expect(
      await app.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM ai_operations WHERE user_id='alice' AND kind='memory' AND created_at>?",
      )
        .bind(boundary)
        .first(),
    ).toEqual({ n: 1 });
  });

  it('呼出枠も24時間境界ちょうどと別ownerを除外し、拒否では試行を追加しない', async () => {
    const job = await articleJob();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await app.env.DB.prepare(
      "INSERT INTO ai_attempts(id,user_id,created_at) VALUES ('boundary-attempt','alice',?),('other-owner-attempt','bob',?)",
    )
      .bind(new Date(now - 86_400_000).toISOString(), new Date(now).toISOString())
      .run();
    app.env.AI_CALL_DAILY_LIMIT = '1';
    const run = vi.fn(async () => ({
      response: 'answer',
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    app.env.AI = { run };
    const operation = async () => {
      await invokeAi(app.env, { messages: [], max_tokens: 1, temperature: 0 });
      return { answer: 'done' };
    };
    expect(await aiStep(app.env, job, mockStep(), 'generate', operation)).toEqual({
      answer: 'done',
    });
    await expect(aiStep(app.env, job, mockStep(), 'other', operation)).rejects.toBeInstanceOf(
      AiLimitError,
    );
    expect(run).toHaveBeenCalledOnce();
    expect(
      await app.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM ai_attempts WHERE user_id='alice'",
      ).first(),
    ).toEqual({ n: 2 });
  });

  it('予約直後の登録失効ではAIを呼ばず、予約済み試行とfailed記録を残す', async () => {
    const job = await articleJob();
    const run = vi.fn();
    app.env.AI = { run };
    let batches = 0;
    const env: Env = {
      ...app.env,
      DB: new Proxy(app.env.DB, {
        get(target, key) {
          if (key === 'batch')
            return async (statements: D1PreparedStatement[]) => {
              const result = await target.batch(statements);
              if (++batches === 2)
                await target
                  .prepare("UPDATE users SET onboarding_completed_at=NULL WHERE id='alice'")
                  .run();
              return result;
            };
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }),
    };
    const operation = vi.fn(async () => {
      await invokeAi(env, { messages: [], max_tokens: 1, temperature: 0 });
      return {};
    });
    await expect(aiStep(env, job, mockStep(), 'generate', operation)).rejects.toThrow('登録');
    expect(batches).toBe(2);
    expect(operation).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(
      await app.env.DB.prepare('SELECT status,retry_blocked FROM ai_calls WHERE id=?')
        .bind(`${job.id}:generate`)
        .first(),
    ).toEqual({ status: 'failed', retry_blocked: 0 });
    expect(
      (await app.env.DB.prepare('SELECT usage_model,usage_complete FROM ai_attempts').all())
        .results,
    ).toEqual([{ usage_model: null, usage_complete: 0 }]);
    expect(await app.env.DB.prepare('SELECT status FROM articles').first()).toEqual({
      status: 'queued',
    });
  });

  it('他ownerの使用量保存では既存試行と利用集計を変更しない', async () => {
    const job = await articleJob();
    app.env.AI = { run: vi.fn() };
    const operation = vi.fn(async () => {
      throw new Error('callback failed before inference');
    });
    await expect(aiStep(app.env, job, mockStep(), 'generate', operation)).rejects.toThrow(
      'callback failed',
    );
    const attempt = (await app.env.DB.prepare('SELECT * FROM ai_attempts').first<{
      id: string;
      user_id: string;
      usage_model: string;
      neurons_micros: number;
      usage_complete: number;
    }>())!;
    const before = (await app.env.DB.prepare('SELECT * FROM ai_usage_daily').all()).results;
    await saveAiUsage(app.env, 'bob', attempt.id, app.env.AI_MODEL, 999_999, true);
    expect(await app.env.DB.prepare('SELECT * FROM ai_attempts').first()).toEqual(attempt);
    expect((await app.env.DB.prepare('SELECT * FROM ai_usage_daily').all()).results).toEqual(
      before,
    );
    expect(attempt).toMatchObject({
      user_id: 'alice',
      usage_model: '',
      neurons_micros: 0,
      usage_complete: 1,
    });
    expect(await app.env.DB.prepare('SELECT status FROM ai_calls').first()).toEqual({
      status: 'failed',
    });
  });
});
