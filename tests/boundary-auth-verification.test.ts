import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../server/index';
import { testApp } from './helpers';
import { mcpTokens } from './mcp-helpers';

describe('B01/B02/B03 境界モデルと実HTTP・OAuth・DBの照合', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await app.dispose();
  });

  const request = (path: string, init: RequestInit = {}) =>
    worker.fetch(new Request(`${app.env.APP_URL}${path}`, init), app.env, app.ctx);
  const session = () => ({
    Cookie: 'stock_session=alice-session',
    Origin: app.env.APP_URL,
    'Content-Type': 'application/json',
  });
  const shortcut = async (project_id: string | null = null) => {
    const created = await app.request('/api/v1/tokens', {
      method: 'POST',
      body: { name: '境界検証', project_id, expires_days: null },
    });
    expect(created.status).toBe(201);
    const token = (await created.json()) as { id: string; token: string };
    return {
      ...token,
      headers: { Authorization: `Bearer ${token.token}`, Cookie: '', Origin: '' },
    };
  };
  const business = async () =>
    Promise.all(
      [
        'SELECT * FROM articles ORDER BY id',
        'SELECT * FROM stocks ORDER BY id',
        'SELECT * FROM projects ORDER BY id',
        'SELECT * FROM processing_jobs ORDER BY id',
        'SELECT * FROM idempotency_keys ORDER BY user_id,key',
        'SELECT id,memory_revision FROM users ORDER BY id',
      ].map(async (sql) => (await app.env.DB.prepare(sql).all()).results),
    );
  const connectionId = async () => {
    const response = await request('/api/v1/mcp/connections', { headers: session() });
    expect(response.status).toBe(200);
    return ((await response.json()) as { connections: { id: string }[] }).connections[0].id;
  };
  const settings = (id: string, project_ids: string[] | null, scopes: string[]) =>
    request(`/api/v1/mcp/connections/${id}`, {
      method: 'PATCH',
      headers: session(),
      body: JSON.stringify({ client_name: '境界検証', project_ids, scopes }),
    });
  const rpc = (token: string, name: string, args = {}) =>
    request('/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Host: new URL(app.env.APP_URL).host,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
  const call = async (token: string, name: string, args = {}) => {
    const response = await rpc(token, name, args);
    expect(response.status).toBe(200);
    const text = await response.text();
    return JSON.parse(
      text.startsWith('event:') || text.startsWith('data:')
        ? text
            .split('\n')
            .find((line) => line.startsWith('data:'))!
            .slice(5)
        : text,
    ).result;
  };

  it('B01 有効トークンの許可表拒否は業務DBを維持し利用日時だけ記録する', async () => {
    const token = await shortcut();
    const before = await business();
    for (const [method, path] of [
      ['GET', '/api/v1/stocks'],
      ['GET', '/api/v1/tokens'],
      ['POST', '/api/v1/projects'],
      ['PATCH', '/api/v1/projects/alice-project'],
      ['DELETE', '/api/v1/projects/alice-project'],
    ]) {
      await app.env.DB.prepare('UPDATE api_tokens SET last_used_at=NULL WHERE id=?')
        .bind(token.id)
        .run();
      expect(
        (
          await app.request(path, {
            method,
            headers: token.headers,
            body: method === 'GET' ? undefined : {},
          })
        ).status,
      ).toBe(403);
      expect(await business()).toEqual(before);
      expect(
        await app.env.DB.prepare('SELECT last_used_at FROM api_tokens WHERE id=?')
          .bind(token.id)
          .first(),
      ).toEqual({ last_used_at: expect.any(String) });
    }
    expect((await app.request('/api/v1/projects', { headers: token.headers })).status).toBe(200);
  });

  it('B02 期限ちょうど・失効は保存を拒否し、期限直前と無期限は認証できる', async () => {
    const token = await shortcut();
    const instant = new Date('2026-11-17T12:00:00.000Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(instant);
    const before = await business();
    await app.env.DB.prepare('UPDATE api_tokens SET expires_at=? WHERE id=?')
      .bind(instant.toISOString(), token.id)
      .run();
    const save = () =>
      app.request('/api/v1/stocks', {
        method: 'POST',
        body: { type: 'text', text: '期限の境界', project_id: 'alice-project' },
        // 有効なCookieも送る。Bearer拒否時にセッションへ戻らないことを確認する。
        headers: { ...token.headers, Cookie: 'stock_session=alice-session' },
      });
    expect((await save()).status).toBe(401);
    expect(await business()).toEqual(before);
    await app.env.DB.prepare('UPDATE api_tokens SET expires_at=? WHERE id=?')
      .bind(new Date(instant.getTime() + 1).toISOString(), token.id)
      .run();
    expect((await app.request('/api/v1/projects', { headers: token.headers })).status).toBe(200);
    await app.env.DB.prepare('UPDATE api_tokens SET expires_at=NULL,revoked_at=? WHERE id=?')
      .bind(instant.toISOString(), token.id)
      .run();
    expect((await save()).status).toBe(401);
    expect(await business()).toEqual(before);
  });

  it('B02 全project省略保存のキー再送は新projectに書かず、キーなし再送は保存する', async () => {
    const token = await shortcut();
    const body = { type: 'text', text: '全プロジェクトの保存境界', note: 'メモ' };
    const save = (key?: string, overrides = {}) =>
      app.request('/api/v1/stocks', {
        method: 'POST',
        body: { ...body, ...overrides },
        headers: { ...token.headers, ...(key ? { 'Idempotency-Key': key } : {}) },
      });
    const first = await save('all-projects');
    expect(first.status).toBe(202);
    const { id } = (await first.json()) as { id: string };
    const destinations = async () =>
      (await app.env.DB.prepare('SELECT user_id,project_id FROM stocks ORDER BY project_id').all())
        .results;
    expect(await destinations()).toEqual([
      { user_id: 'alice', project_id: 'alice-project' },
      { user_id: 'alice', project_id: 'alice-second' },
    ]);
    expect(
      (await app.request('/api/v1/projects', { method: 'POST', body: { name: '追加' } })).status,
    ).toBe(201);
    const before = await business();
    const replay = await save('all-projects');
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ id, duplicate: true });
    expect(await business()).toEqual(before);
    expect((await save('all-projects', { text: '変更された本文' })).status).toBe(409);
    expect((await save(undefined, { project_id: 'bob-project' })).status).toBe(404);
    expect(await business()).toEqual(before);
    expect((await save()).status).toBe(202);
    expect(await destinations()).toHaveLength(3);
    expect(await app.env.DB.prepare('SELECT COUNT(*) AS count FROM articles').first()).toEqual({
      count: 1,
    });
    expect(
      await app.env.DB.prepare('SELECT COUNT(*) AS count FROM idempotency_keys').first(),
    ).toEqual({ count: 1 });
  });

  it('B03 初回単一projectから本人の別projectと全projectへ既存トークンの設定を変更できる', async () => {
    const token = await mcpTokens(app, 'alice-project', ['projects:read']);
    const id = await connectionId();
    expect((await settings(id, ['alice-second'], ['projects:read'])).status).toBe(200);
    expect(
      (await call(token.access_token, 'list_projects')).structuredContent.projects.map(
        (project: { id: string }) => project.id,
      ),
    ).toEqual(['alice-second']);
    expect((await settings(id, null, ['projects:read'])).status).toBe(200);
    const all = (await call(token.access_token, 'list_projects')).structuredContent.projects;
    expect(all.map((project: { id: string }) => project.id).sort()).toEqual([
      'alice-project',
      'alice-second',
    ]);
    const before = await business();
    // APIでは登録できない空集合と未認可scopeも、読込時の縮小を直接照合する。
    await app.env.DB.prepare(
      'UPDATE mcp_connection_settings SET project_ids=?,scopes=? WHERE user_id=? AND grant_id=?',
    )
      .bind('[]', '["projects:read"]', 'alice', id)
      .run();
    expect((await rpc(token.access_token, 'list_projects')).status).toBe(403);
    await app.env.DB.prepare(
      'UPDATE mcp_connection_settings SET project_ids=NULL,scopes=? WHERE user_id=? AND grant_id=?',
    )
      .bind('["projects:read","stocks:write"]', 'alice', id)
      .run();
    const denied = await call(token.access_token, 'add_stock', {
      type: 'text',
      text: '拒否する本文',
      project_id: 'alice-project',
      request_id: crypto.randomUUID(),
    });
    expect(denied).toMatchObject({ isError: true, structuredContent: { status: 403 } });
    expect(await business()).toEqual(before);
  });

  it('B03 tombstoneは発行済みaccess・refreshと設定の復活を拒否する', async () => {
    const token = await mcpTokens(app, 'alice-project', ['projects:read', 'offline_access']);
    const id = await connectionId();
    expect(
      (await settings(id, ['alice-project'], ['projects:read', 'offline_access'])).status,
    ).toBe(200);
    // KVのgrantを残し、DB照会の失効guardそのものを実OAuth入口で通す。
    await app.env.DB.prepare(
      'UPDATE mcp_connection_settings SET revoked=1,scopes=? WHERE user_id=? AND grant_id=?',
    )
      .bind('[]', 'alice', id)
      .run();
    const before = await business();
    expect((await rpc(token.access_token, 'list_projects')).status).toBe(401);
    const refreshed = await request('/oauth/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refresh_token!,
        client_id: token.client_id,
        resource: `${app.env.APP_URL}/mcp`,
      }),
    });
    expect(refreshed.status).toBe(400);
    expect(await refreshed.json()).toMatchObject({ error: 'invalid_grant' });
    expect((await settings(id, null, ['projects:read', 'offline_access'])).status).toBe(404);
    expect(
      await app.env.DB.prepare(
        'SELECT revoked,scopes FROM mcp_connection_settings WHERE user_id=? AND grant_id=?',
      )
        .bind('alice', id)
        .first(),
    ).toEqual({ revoked: 1, scopes: '[]' });
    expect(await business()).toEqual(before);
  });

  it('B03 元認可にofflineがなければ後付け設定でもrefreshを発行せず不正な更新を拒否する', async () => {
    // 交換前のDB設定を変更するため、実PKCE認可をコード発行の時点で止める。
    const registered = await request('/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: '元認可のrefresh境界',
        redirect_uris: ['https://chatgpt.com/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
      }),
    });
    expect(registered.status).toBe(201);
    const { client_id } = (await registered.json()) as { client_id: string };
    const verifier = 'original-offline-boundary-'.padEnd(64, 'a');
    const challenge = Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    ).toString('base64url');
    const params = new URLSearchParams({
      client_id,
      response_type: 'code',
      redirect_uri: 'https://chatgpt.com/callback',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: `${app.env.APP_URL}/mcp`,
      scope: 'projects:read',
    });
    const page = await request(`/oauth/authorize?${params}`, { headers: session() });
    expect(page.status).toBe(200);
    const handle = /name="handle" value="([^"]+)"/.exec(await page.text())![1];
    const approved = await request('/oauth/authorize', {
      method: 'POST',
      headers: {
        ...session(),
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: `stock_session=alice-session; ${page.headers
          .getSetCookie()
          .map((value) => value.split(';')[0])
          .join('; ')}`,
      },
      body: new URLSearchParams({
        handle,
        decision: 'approve',
        project_id: 'alice-project',
        scope: 'projects:read',
      }),
    });
    expect(approved.status).toBe(302);
    const code = new URL(approved.headers.get('Location')!).searchParams.get('code')!;
    const id = await connectionId();
    expect((await settings(id, ['alice-project'], ['projects:read'])).status).toBe(200);
    // 管理APIが拒否する元scope外の権限を、テスト用D1にだけ直接混ぜる。
    await app.env.DB.prepare(
      'UPDATE mcp_connection_settings SET scopes=? WHERE user_id=? AND grant_id=?',
    )
      .bind('["projects:read","offline_access","stocks:write"]', 'alice', id)
      .run();
    const grantKey = `grant:alice:${id}`;
    const readGrant = () =>
      app.env.OAUTH_KV!.get<{ scope: string[]; refreshTokenId?: string }>(grantKey, 'json');
    expect(await readGrant()).toMatchObject({ scope: ['projects:read'] });
    const before = await business();
    const exchanged = await request('/oauth/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id,
        redirect_uri: 'https://chatgpt.com/callback',
        code_verifier: verifier,
        resource: `${app.env.APP_URL}/mcp`,
      }),
    });
    expect(exchanged.status).toBe(200);
    const token = (await exchanged.json()) as { access_token: string; refresh_token?: string };
    expect(token.access_token).toBeTruthy();
    expect(token).not.toHaveProperty('refresh_token');
    const stored = await readGrant();
    expect(stored).toMatchObject({ scope: ['projects:read'] });
    expect(stored).not.toHaveProperty('refreshTokenId');
    expect(stored).not.toHaveProperty('previousRefreshTokenId');
    const refreshed = await request('/oauth/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: `alice:${id}:${crypto.randomUUID()}`,
        client_id,
        resource: `${app.env.APP_URL}/mcp`,
        scope: 'offline_access stocks:write',
      }),
    });
    expect(refreshed.status).toBe(400);
    expect(await refreshed.json()).toMatchObject({ error: 'invalid_grant' });
    expect(await readGrant()).toEqual(stored);
    expect((await call(token.access_token, 'list_projects')).structuredContent.projects).toEqual([
      expect.objectContaining({ id: 'alice-project' }),
    ]);
    expect(
      await call(token.access_token, 'add_stock', {
        type: 'text',
        text: '後付けscopeでは保存できない',
        project_id: 'alice-project',
        request_id: crypto.randomUUID(),
      }),
    ).toMatchObject({ isError: true, structuredContent: { status: 403 } });
    expect(await business()).toEqual(before);
  });
});
