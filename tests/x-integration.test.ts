import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import { testApp, mockEvent, mockStep } from './helpers';
import { encryptToken, xPostId, xToken } from '../server/x';
import { fetchArticle } from '../server/ingest';
import { ArticleWorkflow } from '../server/workflows';
import { createApp } from '../server/api';
import type { Job } from '../server/env';

describe('X外部連携と本文補完', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  const token = 'test-x-token-do-not-disclose';
  beforeEach(async () => {
    app = await testApp();
    app.env.INTEGRATION_ENCRYPTION_KEY = 'ab'.repeat(32);
    app.env.LOCAL_DEMO_ENABLED = 'true';
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.dispose();
  });
  const register = (user = 'alice') =>
    app.request('/api/v1/integrations/x', { method: 'PUT', user, body: { token } });
  it('暗号化保存し本人だけが更新・削除でき、値を返さない', async () => {
    expect((await register()).status).toBe(200);
    const row = await app.env.DB.prepare(
      'SELECT encrypted_token FROM external_integrations WHERE user_id = ?',
    )
      .bind('alice')
      .first<{ encrypted_token: string }>();
    expect(row!.encrypted_token).not.toContain(token);
    expect(await xToken(app.env, 'alice')).toBe(token);
    expect(await encryptToken(app.env, 'alice', token)).not.toBe(row!.encrypted_token);
    expect(await (await app.request('/api/v1/integrations/x')).json()).toMatchObject({
      configured: true,
      available: true,
    });
    expect(
      await (await app.request('/api/v1/integrations/x', { user: 'bob' })).json(),
    ).toMatchObject({ configured: false });
    expect(
      (await app.request('/api/v1/integrations/x', { method: 'DELETE', user: 'bob' })).status,
    ).toBe(200);
    expect(await xToken(app.env, 'alice')).toBe(token);
    await app.env.DB.prepare(
      "INSERT INTO external_integrations (user_id,provider,encrypted_token) VALUES ('bob','x',?)",
    )
      .bind(row!.encrypted_token)
      .run();
    await expect(xToken(app.env, 'bob')).rejects.toThrow('読み出せません');
    expect(
      (
        await app.request('/api/v1/integrations/x', {
          method: 'PUT',
          body: { token: 'replacement-token' },
        })
      ).status,
    ).toBe(200);
    expect(await xToken(app.env, 'alice')).toBe('replacement-token');
    expect((await app.request('/api/v1/integrations/x', { method: 'DELETE' })).status).toBe(200);
    await expect(xToken(app.env, 'alice')).rejects.toThrow('登録');
  });
  it('秘密キー未設定・未認証・CSRF・MCP・共有トークンを拒否する', async () => {
    app.env.INTEGRATION_ENCRYPTION_KEY = undefined;
    expect((await register()).status).toBe(503);
    expect((await app.request('/api/v1/integrations/x', { headers: { Cookie: '' } })).status).toBe(
      401,
    );
    expect(
      (
        await app.request('/api/v1/integrations/x', {
          method: 'PUT',
          body: { token },
          headers: { Origin: 'https://evil.example.com' },
        })
      ).status,
    ).toBe(403);
    const { token: shareToken } = (await (
      await app.request('/api/v1/tokens', { method: 'POST', body: { name: 'share' } })
    ).json()) as { token: string };
    for (const method of ['GET', 'PUT', 'DELETE']) {
      expect(
        (
          await app.request('/api/v1/integrations/x', {
            method,
            ...(method === 'PUT' ? { body: { token } } : {}),
            headers: { Cookie: '', Authorization: `Bearer ${shareToken}` },
          })
        ).status,
      ).toBe(403);
      const mcp = createApp({
        user: {
          id: 'alice',
          name: 'Alice',
          onboarding_completed_at: '2026-10-30T00:00:00Z',
          bio: '',
          avatar_url: null,
        },
        kind: 'mcp',
        tokenProjectId: null,
      });
      expect(
        (await mcp.request('http://localhost/api/v1/integrations/x', { method }, app.env, app.ctx))
          .status,
      ).toBe(403);
    }
  });
  it('X・旧TwitterのURLを認識し、短文・長文を固定APIだけから取得する', async () => {
    for (const host of ['x.com', 'twitter.com', 'mobile.twitter.com'])
      expect(xPostId(`https://${host}/person/status/123?s=20`)).toBe('123');
    expect(xPostId('https://x.com/i/web/status/123')).toBe('123');
    expect(xPostId('https://x.com.evil.com/person/status/123')).toBeNull();
    await register();
    const network = vi.fn(
      async () => new Response(JSON.stringify({ data: { id: '123', text: '短文' } })),
    );
    vi.stubGlobal('fetch', network);
    expect((await fetchArticle(app.env, 'https://x.com/person/status/123', 'alice')).text).toBe(
      '短文',
    );
    expect(network).toHaveBeenCalledWith(
      'https://api.x.com/2/tweets/123?tweet.fields=note_tweet',
      expect.objectContaining({
        redirect: 'manual',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      }),
    );
    network.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { id: '123', text: '省略', note_tweet: { text: '長文の全文' } } }),
      ),
    );
    expect(
      (await fetchArticle(app.env, 'https://twitter.com/person/status/123', 'alice')).text,
    ).toBe('長文の全文');
    await expect(fetchArticle(app.env, 'https://x.com/person/status/123', 'bob')).rejects.toThrow(
      '登録',
    );
    expect(network).toHaveBeenCalledTimes(2);
  });
  it('APIや通信のエラー内容・トークンを公開しない', async () => {
    await register();
    const network = vi.fn();
    vi.stubGlobal('fetch', network);
    for (const status of [401, 403, 404, 429, 500, 302]) {
      network.mockResolvedValueOnce(
        new Response(token, { status, headers: { Location: 'https://evil.example.com' } }),
      );
      await expect(fetchArticle(app.env, 'https://x.com/u/status/123', 'alice')).rejects.toThrow(
        `HTTP ${status}`,
      );
    }
    network.mockRejectedValueOnce(new Error(`secret ${token}`));
    await expect(fetchArticle(app.env, 'https://x.com/u/status/123', 'alice')).rejects.toThrow(
      '時間をおくか',
    );
  });
  it('Workersが受理できるリクエストでX本文を取得する', async () => {
    await register();
    const runtime = new Miniflare({
      modules: true,
      compatibilityDate: '2026-07-30',
      script: `export default {
        async fetch(request) {
          const { url, redirect } = await request.json();
          new Request(url, { redirect });
          return Response.json({ data: { id: '123', text: '投稿本文' } });
        }
      };`,
    });
    try {
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) =>
        runtime.dispatchFetch('http://localhost/', {
          method: 'POST',
          body: JSON.stringify({ url, redirect: init?.redirect }),
        }),
      );
      await expect(
        fetchArticle(app.env, 'https://x.com/person/status/123?s=12', 'alice'),
      ).resolves.toEqual({ title: '投稿本文', text: '投稿本文' });
    } finally {
      await runtime.dispose();
    }
  });
  it('URLを残して補完本文で保存・失敗後の再試行を行い、外部通信をしない', async () => {
    const response = await app.request('/api/v1/stocks', {
      method: 'POST',
      body: {
        url: 'https://x.com/u/status/123',
        project_id: 'alice-project',
        supplemental_text: '貼り付けた投稿本文',
      },
      headers: { 'Idempotency-Key': 'supplement' },
    });
    expect(response.status).toBe(202);
    const { id } = (await response.json()) as { id: string };
    expect(
      (
        await app.request('/api/v1/stocks', {
          method: 'POST',
          body: {
            url: 'https://x.com/u/status/123',
            project_id: 'alice-project',
            supplemental_text: '変更した本文',
          },
          headers: { 'Idempotency-Key': 'supplement' },
        })
      ).status,
    ).toBe(409);
    const job = await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE kind='article'",
    ).first<Job>();
    const network = vi.fn(() => {
      throw new Error('通信禁止');
    });
    vi.stubGlobal('fetch', network);
    await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(job!.id), mockStep());
    expect(await (await app.request(`/api/v1/stocks/${id}/content`)).json()).toEqual({
      content: '貼り付けた投稿本文',
    });
    await app.env.DB.prepare("UPDATE articles SET status='failed' WHERE id=?")
      .bind(job!.target_id)
      .run();
    expect(
      (
        await app.request(`/api/v1/stocks/${id}/retry`, {
          method: 'POST',
          body: { supplemental_text: 'あ'.repeat(20000) },
        })
      ).status,
    ).toBe(202);
    const next = await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE kind='article' ORDER BY revision DESC",
    ).first<Job>();
    await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(next!.id), mockStep());
    expect(await (await app.request(`/api/v1/stocks/${id}/content`)).json()).toEqual({
      content: 'あ'.repeat(20000),
    });
    expect(network).not.toHaveBeenCalled();
  });
});
