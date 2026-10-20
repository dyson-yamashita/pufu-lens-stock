import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../server/index';
import { testApp } from './helpers';
import { allMcpScopes, mcpTokens } from './mcp-helpers';

describe('MCPクライアントの事前登録制限', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
  });
  afterEach(async () => {
    await app.dispose();
  });
  const register = (ip = '198.51.100.42', extraHeaders: Record<string, string> = {}) =>
    worker.fetch(
      new Request(`${app.env.APP_URL}/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...extraHeaders },
        body: JSON.stringify({
          client_name: 'ChatGPT test',
          redirect_uris: ['https://chatgpt.com/callback'],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
        }),
      }),
      app.env,
      app.ctx,
    );

  it('同じIPの11件目を429にして保存せず、転送ヘッダーでも回避できない', async () => {
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        register('198.51.100.42', {
          Origin: 'https://chatgpt.com',
          'X-Forwarded-For': `203.0.113.${index + 1}`,
          'X-Real-IP': `203.0.113.${index + 1}`,
        }),
      ),
    );
    expect(responses.filter((r) => r.status === 201)).toHaveLength(10);
    const rejected = responses.filter((r) => r.status === 429);
    expect(rejected).toHaveLength(2);
    expect(rejected[0].headers.get('Retry-After')).toBe('60');
    expect(rejected[0].headers.get('Cache-Control')).toBe('no-store');
    expect(rejected[0].headers.get('Access-Control-Allow-Origin')).toBe('https://chatgpt.com');
    expect(rejected[0].headers.get('Access-Control-Expose-Headers')).toContain('Retry-After');
    expect((await app.env.OAUTH_KV!.list({ prefix: 'client:' })).keys).toHaveLength(10);
    expect((await register('203.0.113.9')).status).toBe(201);
    const preflight = await worker.fetch(
      new Request(`${app.env.APP_URL}/oauth/register`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://chatgpt.com',
          'CF-Connecting-IP': '198.51.100.42',
          'Access-Control-Request-Method': 'POST',
        },
      }),
      app.env,
      app.ctx,
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('https://chatgpt.com');
    expect(
      (
        await worker.fetch(
          new Request(`${app.env.APP_URL}/.well-known/oauth-authorization-server`),
          app.env,
          app.ctx,
        )
      ).status,
    ).toBe(200);
  });

  it('登録データは90日で期限切れとなり、ユーザー認証前でも通常の登録はできる', async () => {
    const before = Math.floor(Date.now() / 1000);
    const response = await register();
    expect(response.status).toBe(201);
    const { client_id } = (await response.json()) as { client_id: string };
    const key = (await app.env.OAUTH_KV!.list({ prefix: 'client:' })).keys.find(
      (k) => k.name === `client:${client_id}`,
    )!;
    expect(key.expiration).toBeGreaterThanOrEqual(before + 90 * 86400);
    expect(key.expiration).toBeLessThanOrEqual(Math.ceil(Date.now() / 1000) + 90 * 86400);
  });

  it('IPがない要求も同じ枠で制限し、IPの生値をキーに渡さない', async () => {
    const limiter = app.env.OAUTH_REGISTRATION_RATE_LIMITER!;
    const limit = vi.fn(limiter.limit.bind(limiter));
    app.env.OAUTH_REGISTRATION_RATE_LIMITER = { limit };
    for (let index = 0; index < 11; index++) {
      const response = await register('', { 'X-Forwarded-For': `203.0.113.${index + 1}` });
      expect(response.status).toBe(index < 10 ? 201 : 429);
    }
    expect(new Set(limit.mock.calls.map(([options]) => options.key)).size).toBe(1);
    await register('203.0.113.99');
    expect(limit.mock.calls.at(-1)![0].key).toMatch(/^[a-f0-9]{64}$/);
  });

  it('登録制限中も既存の連携はトークンを更新でき、利用中の登録期限を延長する', async () => {
    const tokens = await mcpTokens(app, null, [...allMcpScopes, 'offline_access']);
    const clientKey = `client:${tokens.client_id}`;
    const client = await app.env.OAUTH_KV!.get<Record<string, unknown>>(clientKey, 'json');
    // 登録の有効期間が半分を過ぎた状態を作り、SDKの更新経路を実行する。
    await app.env.OAUTH_KV!.put(
      clientKey,
      JSON.stringify({
        ...client,
        registrationExpiresAt: Math.floor(Date.now() / 1000) + 30 * 86400,
      }),
      { expirationTtl: 30 * 86400 },
    );
    const limit = vi.fn(async () => ({ success: false }));
    app.env.OAUTH_REGISTRATION_RATE_LIMITER = { limit };
    const before = Math.floor(Date.now() / 1000);
    const response = await worker.fetch(
      new Request(`${app.env.APP_URL}/oauth/token`, {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: tokens.client_id,
          refresh_token: tokens.refresh_token!,
          resource: `${app.env.APP_URL}/mcp`,
        }),
      }),
      app.env,
      app.ctx,
    );
    expect(response.status).toBe(200);
    // waitUntilに渡された期限延長の完了を待つ。
    await app.request('/api/v1/me');
    expect(limit).not.toHaveBeenCalled();
    const key = (await app.env.OAUTH_KV!.list({ prefix: 'client:' })).keys.find(
      (k) => k.name === clientKey,
    )!;
    expect(key.expiration).toBeGreaterThanOrEqual(before + 90 * 86400);
  });

  it.each(['missing', 'failed'])(
    '制限機能が%sの場合は503にして未制限の登録を許可しない',
    async (mode) => {
      if (mode === 'missing') delete app.env.OAUTH_REGISTRATION_RATE_LIMITER;
      else
        app.env.OAUTH_REGISTRATION_RATE_LIMITER = {
          limit: vi.fn(async () => {
            throw new Error('limiter unavailable');
          }),
        };
      const response = await register('198.51.100.42', { Origin: 'https://chatgpt.com' });
      expect(response.status).toBe(503);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://chatgpt.com');
      expect(response.headers.get('Access-Control-Expose-Headers')).toContain('Retry-After');
      expect((await app.env.OAUTH_KV!.list({ prefix: 'client:' })).keys).toHaveLength(0);
    },
  );
});
