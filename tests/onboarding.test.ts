import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdir } from 'node:fs/promises';
import { inspect } from 'node:util';
import { applyMigration, testApp } from './helpers';
import worker from '../server/index';
import { mcpToken, mcpTokens } from './mcp-helpers';
import { mcpAuthorizationApp } from '../server/mcp-oauth';

const acceptance = {
  name: '  ふくろう  ',
  terms_accepted: true,
  privacy_accepted: true,
  terms_version: '2026-10-30',
  privacy_version: '2026-10-30',
};
describe('初回のニックネームと規約への同意', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp({ onboarding: false });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await app.dispose();
  });
  const accept = (body: unknown = acceptance, headers: Record<string, string> = {}) =>
    app.request('/api/v1/onboarding', { method: 'POST', body, headers });

  it('未登録では本人情報とログアウトだけ利用でき、保存APIは利用できない', async () => {
    const identity = await app.request('/api/v1/me');
    expect(identity.status).toBe(200);
    expect(await identity.json()).toMatchObject({ user: { onboarding_completed_at: null } });
    expect((await app.request('/api/v1/projects')).status).toBe(403);
    expect((await app.request('/api/v1/stocks', { method: 'POST', body: {} })).status).toBe(403);
    expect(
      (await app.request('/api/v1/me', { method: 'PATCH', body: { name: '回避', bio: '' } }))
        .status,
    ).toBe(403);
    expect((await app.request('/api/v1/logout', { method: 'POST' })).status).toBe(200);
  });

  it('MCP認可は初回登録へ戻し、OK後にブラウザに紐づく認可を再開する', async () => {
    await accept();
    const { client_id } = await mcpTokens(app);
    await app.env.DB.prepare(
      "UPDATE users SET onboarding_completed_at=NULL WHERE id='alice'",
    ).run();
    const params = new URLSearchParams({
      client_id,
      response_type: 'code',
      redirect_uri: 'https://chatgpt.com/callback',
      scope: 'projects:read',
      resource: `${app.env.APP_URL}/mcp`,
      code_challenge_method: 'S256',
      code_challenge: 'a'.repeat(43),
    });
    const fetch = (path: string, cookie = 'stock_session=alice-session') =>
      worker.fetch(
        new Request(`${app.env.APP_URL}${path}`, { headers: { Cookie: cookie } }),
        app.env,
        app.ctx,
      );
    expect((await fetch('/api/v1/mcp/connections')).status).toBe(403);
    const page = await fetch(`/oauth/authorize?${params}`);
    expect(page.status).toBe(302);
    expect(page.headers.get('Location')).toBe('/');
    const pending = page.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('stock_mcp_login='))!
      .split(';')[0];
    const accepted = await accept(acceptance, {
      Cookie: `stock_session=alice-session; ${pending}`,
    });
    const { redirect_to } = (await accepted.json()) as { redirect_to: string };
    expect(redirect_to).toBe(`/oauth/authorize?${params}`);
    const resumed = await fetch(redirect_to);
    expect(resumed.status).toBe(200);
    expect(await resumed.text()).toContain('ふくろう');
  });

  it.each([
    { terms_accepted: false },
    { privacy_accepted: false },
    { name: ' \n ' },
    { name: '名'.repeat(81) },
    { terms_version: 'old' },
    { privacy_version: 'old' },
    { terms_accepted: 'true' },
    { email: 'private@example.com' },
  ])('不完全な登録を保存しない: %j', async (invalid) => {
    expect((await accept({ ...acceptance, ...invalid })).status).toBe(400);
    const response = await app.request('/api/v1/me');
    expect(await response.json()).toMatchObject({ user: { onboarding_completed_at: null } });
    expect((await app.request('/api/v1/projects')).status).toBe(403);
  });

  it('名前・両方の同意・版・日時を同時に保存し、次のセッションにも保持する', async () => {
    const response = await accept();
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      user: { name: string; onboarding_completed_at: string };
    };
    expect(data.user.name).toBe('ふくろう');
    expect(Number.isNaN(Date.parse(data.user.onboarding_completed_at))).toBe(false);
    expect(data.user).not.toHaveProperty('email');
    expect(
      await app.env.DB.prepare('SELECT terms_version,privacy_version FROM users WHERE id=?')
        .bind('alice')
        .first(),
    ).toEqual({ terms_version: '2026-10-30', privacy_version: '2026-10-30' });
    expect((await app.request('/api/v1/projects')).status).toBe(200);
    const again = await accept({ ...acceptance, name: '重複登録' });
    expect(await again.json()).toMatchObject({ user: data.user });
    expect((await app.request('/api/v1/projects', { user: 'bob' })).status).toBe(403);
  });

  it('未認証・別サイト・既存Bearerからの同意を拒否する', async () => {
    expect((await accept(acceptance, { Cookie: '' })).status).toBe(401);
    expect((await accept(acceptance, { Origin: 'https://evil.example' })).status).toBe(403);
    // 同意済みの間に発行したトークンでも、未同意へ戻った状態の利用を許可しない。
    await accept();
    const result = await app.request('/api/v1/tokens', {
      method: 'POST',
      body: { name: 'Shortcut' },
    });
    const { token } = (await result.json()) as { token: string };
    await app.env.DB.prepare('UPDATE users SET onboarding_completed_at=NULL WHERE id=?')
      .bind('alice')
      .run();
    const headers = { Authorization: `Bearer ${token}`, Cookie: '' };
    expect((await accept(acceptance, headers)).status).toBe(403);
    expect((await app.request('/api/v1/projects', { headers })).status).toBe(403);
  });

  it('既存のMCP認可を使っても未同意のユーザーは利用できない', async () => {
    await accept();
    const token = await mcpToken(app);
    await app.env.DB.prepare('UPDATE users SET onboarding_completed_at=NULL WHERE id=?')
      .bind('alice')
      .run();
    const response = await worker.fetch(
      new Request(`${app.env.APP_URL}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
      app.env,
      app.ctx,
    );
    expect(response.status).toBe(403);
  });

  it('想定外の認可エラーにメールが含まれてもログに出さない', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    app.env.OAUTH_PROVIDER = {
      parseAuthRequest: async () => {
        throw new Error('private@example.com');
      },
    } as unknown as NonNullable<typeof app.env.OAUTH_PROVIDER>;
    const response = await mcpAuthorizationApp.request(
      `${app.env.APP_URL}/oauth/authorize`,
      {},
      app.env,
      app.ctx,
    );
    expect(response.status).toBe(500);
    expect(logged).toHaveBeenCalled();
    expect(inspect(logged.mock.calls)).not.toContain('private@example.com');
  });
  it('OAuthの不正パラメーターやメタデータ取得失敗でもメールをログへ出さない', async () => {
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('Cloudflare', { compatibilityFlags: { global_fetch_strictly_public: true } });
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      return url.hostname === 'client.example'
        ? Promise.resolve(new Response('unavailable', { status: 503 }))
        : originalFetch(input, init);
    });
    const token = await worker.fetch(
      new Request(`${app.env.APP_URL}/oauth/token`, {
        method: 'POST',
        body: new URLSearchParams([
          ['private@example.com', 'a'],
          ['private@example.com', 'b'],
        ]),
      }),
      app.env,
      app.ctx,
    );
    expect(token.status).toBe(400);
    const params = new URLSearchParams({
      client_id: 'https://client.example/metadata?contact=private@example.com',
      response_type: 'code',
      redirect_uri: 'https://chatgpt.com/callback',
      code_challenge_method: 'S256',
      code_challenge: 'a'.repeat(43),
      resource: `${app.env.APP_URL}/mcp`,
    });
    const metadata = await worker.fetch(
      new Request(`${app.env.APP_URL}/oauth/authorize?${params}`),
      app.env,
      app.ctx,
    );
    expect(metadata.status).toBeGreaterThanOrEqual(400);
    expect(inspect([...warnings.mock.calls, ...errors.mock.calls])).not.toContain(
      'private@example.com',
    );
  });
  it('外側のMCPハンドラーの例外にもメールを含めない', async () => {
    await accept();
    const token = await mcpToken(app);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const database = app.env.DB;
    app.env.DB = new Proxy(database, {
      get(target, property) {
        if (property === 'prepare')
          return () => {
            throw new Error('private@example.com');
          };
        return Reflect.get(target, property);
      },
    });
    try {
      const response = await worker.fetch(
        new Request(`${app.env.APP_URL}/mcp`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        }),
        app.env,
        app.ctx,
      );
      expect(response.status).toBe(500);
      expect(inspect(logged.mock.calls)).not.toContain('private@example.com');
    } finally {
      app.env.DB = database;
    }
  });

  it('移行で旧メール列・名前・画像を消去し、コンテンツとセッションを保持する', async () => {
    await app.dispose();
    const migrations = (await readdir(new URL('../migrations/', import.meta.url)))
      .filter((name) => name.endsWith('.sql') && name !== '0033_privacy_onboarding.sql')
      .sort();
    app = await testApp({ migrations, onboardingMigration: false });
    const projects = (await app.env.DB.prepare('SELECT * FROM projects ORDER BY id').all()).results;
    const sessions = (await app.env.DB.prepare('SELECT * FROM sessions ORDER BY user_id').all())
      .results;
    await app.env.DB.prepare(
      "INSERT INTO memories(id,user_id,project_id,revision,text,data_json,article_count,model) VALUES ('um-alice','alice',NULL,0,'旧Google名を使ったメモリ','{}',0,'test')",
    ).run();
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO processing_jobs(id,user_id,kind,target_id,revision,status) VALUES ('old-user-memory','alice','user_memory','alice',0,'done'),('keep-article','alice','article','article',0,'done')",
      ),
      app.env.DB.prepare(
        "INSERT INTO ai_calls(id,job_id,user_id,status,result_json) VALUES ('old-user-memory:generate','old-user-memory','alice','done','private@example.com'),('keep-article:generate','keep-article','alice','done','article summary')",
      ),
    ]);
    await applyMigration(app.env.DB, '0033_privacy_onboarding.sql');
    const users = (await app.env.DB.prepare('SELECT * FROM users').all()).results;
    expect(users).toHaveLength(2);
    for (const user of users) {
      expect(user).not.toHaveProperty('email');
      expect(user).toMatchObject({ name: '', avatar_url: null, onboarding_completed_at: null });
    }
    expect((await app.env.DB.prepare('SELECT * FROM projects ORDER BY id').all()).results).toEqual(
      projects,
    );
    expect(
      (await app.env.DB.prepare('SELECT * FROM sessions ORDER BY user_id').all()).results,
    ).toEqual(sessions);
    expect(
      (await app.env.DB.prepare('SELECT * FROM memories WHERE project_id IS NULL').all()).results,
    ).toHaveLength(0);
    expect((await app.env.DB.prepare('SELECT id,result_json FROM ai_calls').all()).results).toEqual(
      [{ id: 'keep-article:generate', result_json: 'article summary' }],
    );
    expect((await app.env.DB.prepare('SELECT id FROM privacy_cleanup_jobs').all()).results).toEqual(
      [{ id: 'old-user-memory' }],
    );
  });
});
