import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../server/index';
import { testApp } from './helpers';
import { parseHTML } from 'linkedom';

describe('MCP OAuth連携', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
  });
  afterEach(async () => {
    await app.dispose();
  });

  const request = (path: string, init: RequestInit = {}) =>
    worker.fetch(new Request(`${app.env.APP_URL}${path}`, init), app.env, app.ctx);
  const session = { Cookie: 'stock_session=alice-session', Origin: 'http://localhost:5173' };
  const scopes =
    'projects:read stocks:read stocks:write questions:read questions:write offline_access';
  it('OAuth用KVが未設定でも本人に接続URLと未設定状態を返す', async () => {
    delete app.env.OAUTH_KV;
    const response = await request('/api/v1/mcp/connections', { headers: session });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: false,
      url: 'http://localhost:5173/mcp',
      connections: [],
    });
    expect((await request('/api/v1/mcp/connections')).status).toBe(401);
    const { token } = (await (
      await app.request('/api/v1/tokens', { method: 'POST', body: { name: 'Shortcut' } })
    ).json()) as { token: string };
    expect(
      (await request('/api/v1/mcp/connections', { headers: { Authorization: `Bearer ${token}` } }))
        .status,
    ).toBe(403);
    expect((await request('/mcp')).status).toBe(503);
    expect((await request('/oauth/authorize')).status).toBe(503);
  });
  async function authorize(
    options: {
      project?: string;
      projects?: string[];
      selectedScopes?: string;
      user?: string;
      decision?: string;
      noCookie?: boolean;
      theme?: string;
    } = {},
  ) {
    const registered = await request('/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: '<ChatGPT>',
        redirect_uris: ['https://chatgpt.com/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    });
    expect(registered.status).toBe(201);
    const client = (await registered.json()) as { client_id: string };
    const verifier = 'a'.repeat(64);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const params = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: 'https://chatgpt.com/callback',
      response_type: 'code',
      scope: scopes,
      state: 'original-state',
      code_challenge: Buffer.from(digest).toString('base64url'),
      code_challenge_method: 'S256',
      resource: `${app.env.APP_URL}/mcp`,
    });
    const page = await request(`/oauth/authorize?${params}`, {
      headers: {
        ...session,
        Cookie: `${session.Cookie}${options.theme ? `; pufu_lens_theme=${options.theme}` : ''}`,
      },
    });
    expect(page.status).toBe(200);
    const html = await page.text();
    const { document } = parseHTML(html);
    expect(document.documentElement.getAttribute('data-theme')).toBe(
      options.theme === 'dark' || options.theme === 'light' ? options.theme : null,
    );
    expect(document.querySelector('h1')?.textContent).toContain('<ChatGPT>');
    expect(document.querySelector('ChatGPT')).toBeNull();
    const handle = /name="handle" value="([^"]+)"/.exec(html)![1];
    const cookies = page.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    const form = new URLSearchParams({
      handle,
      decision: options.decision ?? 'approve',
      project_id: options.project ?? '',
    });
    if (options.projects) {
      form.set('project_access', 'selected');
      form.delete('project_id');
      options.projects.forEach((id) => form.append('project_id', id));
    }
    for (const scope of (options.selectedScopes ?? scopes).split(' ')) form.append('scope', scope);
    const approve = await request('/oauth/authorize', {
      method: 'POST',
      headers: {
        ...session,
        Cookie: `stock_session=${options.user ?? 'alice'}-session; ${options.noCookie ? '' : cookies}`,
      },
      body: form,
    });
    return { client, verifier, approve, params, form, cookies, html };
  }
  async function exchange(auth: Awaited<ReturnType<typeof authorize>>, verifier = auth.verifier) {
    const callback = new URL(auth.approve.headers.get('Location')!);
    expect(callback.searchParams.get('state')).toBe('original-state');
    return request('/oauth/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: callback.searchParams.get('code')!,
        client_id: auth.client.client_id,
        redirect_uri: 'https://chatgpt.com/callback',
        code_verifier: verifier,
        resource: `${app.env.APP_URL}/mcp`,
      }),
    });
  }
  it('English consent preserves escaped client identity, scope IDs and approval flow', async () => {
    await app.env.DB.prepare(
      "UPDATE users SET language='en',name='<Alice>' WHERE id='alice'",
    ).run();
    const auth = await authorize();
    const { document } = parseHTML(auth.html);
    expect(document.documentElement.lang).toBe('en');
    expect(document.querySelector('h1')?.textContent).toBe('Allow connection to <ChatGPT>');
    expect(document.querySelector('Alice')).toBeNull();
    expect(document.querySelector('button[value="approve"]')?.textContent).toBe('Allow connection');
    expect(
      [...document.querySelectorAll('input[name="scope"]')].map((input) =>
        input.getAttribute('value'),
      ),
    ).toContain('pufus:write');
    expect(document.querySelector('input[name="handle"]')?.getAttribute('value')).toBeTruthy();
    expect(auth.approve.status).toBe(302);
    expect((await exchange(auth)).status).toBe(200);
  });
  it('認可情報を公開し未認証MCPを401で拒否する', async () => {
    const metadata = await request('/.well-known/oauth-protected-resource/mcp');
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({
      resource: `${app.env.APP_URL}/mcp`,
      authorization_servers: [app.env.APP_URL],
    });
    const response = await request('/mcp', { method: 'POST', body: '{}' });
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain('resource_metadata');
  });
  it.each(['light', 'dark', 'system', 'invalid'])(
    '許可画面にブラウザの表示設定を反映し、明暗以外はOSに従う（%s）',
    async (theme) => {
      const auth = await authorize({ theme, decision: 'deny' });
      expect(auth.approve.status).toBe(302);
    },
  );
  it('同意・PKCEでトークンを発行し、本人だけが連携を一覧・失効できる', async () => {
    const auth = await authorize({ project: 'alice-project' });
    expect(auth.approve.status).toBe(302);
    const response = await exchange(auth);
    expect(response.status).toBe(200);
    const tokens = (await response.json()) as { access_token: string; refresh_token: string };
    expect(tokens.refresh_token).toBeTruthy();
    const refreshed = await request('/oauth/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: auth.client.client_id,
        resource: `${app.env.APP_URL}/mcp`,
      }),
    });
    expect(refreshed.status).toBe(200);
    expect(((await refreshed.json()) as { access_token: string }).access_token).toBeTruthy();
    const listing = await request('/api/v1/mcp/connections', { headers: session });
    expect(listing.status).toBe(200);
    const { enabled, url, connections } = (await listing.json()) as {
      enabled: boolean;
      url: string;
      connections: { id: string; project_id: string }[];
    };
    expect(enabled).toBe(true);
    expect(url).toBe('http://localhost:5173/mcp');
    expect(connections).toHaveLength(1);
    expect(connections[0].project_id).toBe('alice-project');
    const id = connections[0].id;
    expect(
      (
        await request(`/api/v1/mcp/connections/${id}`, {
          method: 'DELETE',
          headers: { ...session, Cookie: 'stock_session=bob-session' },
        })
      ).status,
    ).toBe(404);
    expect(
      (await request(`/api/v1/mcp/connections/${id}`, { method: 'DELETE', headers: session }))
        .status,
    ).toBe(200);
    expect(
      (await request('/mcp', { headers: { Authorization: `Bearer ${tokens.access_token}` } }))
        .status,
    ).toBe(401);
    expect(
      (
        await request('/oauth/token', {
          method: 'POST',
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: tokens.refresh_token,
            client_id: auth.client.client_id,
            resource: `${app.env.APP_URL}/mcp`,
          }),
        })
      ).status,
    ).toBe(400);
  });
  it('誤ったPKCE・他ユーザーの保存先・同意時のアカウント切替を拒否する', async () => {
    const auth = await authorize();
    expect((await exchange(auth, 'b'.repeat(64))).status).toBe(400);
    expect((await authorize({ project: 'bob-project' })).approve.status).toBe(404);
    expect((await authorize({ user: 'bob' })).approve.status).toBe(403);
  });
  it('未ログイン時は認可要求を保持してログインに案内する', async () => {
    const auth = await authorize();
    const response = await request(`/oauth/authorize?${auth.params}`);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/api/auth/google');
    expect(response.headers.getSetCookie().join('')).toContain('stock_mcp_login=');
  });
  it('同意の拒否・再送・別ブラウザからの同意を検証する', async () => {
    const denied = await authorize({ decision: 'deny' });
    expect(new URL(denied.approve.headers.get('Location')!).searchParams.get('error')).toBe(
      'access_denied',
    );
    const approved = await authorize();
    expect(
      (
        await request('/oauth/authorize', {
          method: 'POST',
          headers: { ...session, Cookie: `stock_session=alice-session; ${approved.cookies}` },
          body: approved.form,
        })
      ).status,
    ).toBe(403);
    expect((await authorize({ noCookie: true })).approve.status).toBe(400);
  });
  it('継続アクセスを許可しない場合は更新トークンを発行しない', async () => {
    const auth = await authorize({ selectedScopes: 'projects:read stocks:read questions:read' });
    const response = await exchange(auth);
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty('refresh_token');
  });
  it('初回の複数選択で空選択・他人のプロジェクトを拒否し本人の選択を保存する', async () => {
    expect((await authorize({ projects: [] })).approve.status).toBe(400);
    expect((await authorize({ projects: ['alice-project', 'bob-project'] })).approve.status).toBe(
      404,
    );
    const auth = await authorize({ projects: ['alice-project', 'alice-second'] });
    expect(auth.approve.status).toBe(302);
    const { document } = parseHTML(auth.html);
    expect(document.querySelector('button[value="approve"]')?.className).toBe(
      'button primary approve',
    );
    expect(document.querySelector('button[value="deny"]')?.className).toBe('button secondary');
    expect(document.querySelectorAll('input[type="checkbox"][name="project_id"]')).toHaveLength(2);
    expect((await exchange(auth)).status).toBe(200);
    const listing = await request('/api/v1/mcp/connections', { headers: session });
    expect(await listing.json()).toMatchObject({
      connections: [{ project_ids: ['alice-project', 'alice-second'] }],
    });
  });
});
