import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import worker from '../server/index';
import { testApp } from './helpers';
import { mcpTokens } from './mcp-helpers';

let app: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  app = await testApp();
});
afterEach(async () => {
  await app.dispose();
});
const session = {
  Cookie: 'stock_session=alice-session',
  Origin: 'http://localhost:5173',
  'Content-Type': 'application/json',
};
const request = (path: string, init: RequestInit = {}) =>
  worker.fetch(new Request(`${app.env.APP_URL}${path}`, init), app.env, app.ctx);
const list = async () =>
  (await (await request('/api/v1/mcp/connections', { headers: session })).json()) as {
    connections: { id: string; client_name: string; project_id: string | null; scopes: string[] }[];
  };
const update = (id: string, body: unknown, headers = session) =>
  request(`/api/v1/mcp/connections/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
async function call(token: string, name: string, args = {}) {
  const response = await request('/mcp', {
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
}
it('保存した名前・対象・権限を一覧と既存/更新トークンに適用する', async () => {
  const tokens = await mcpTokens(app, null, ['projects:read', 'stocks:read', 'offline_access']);
  expect(
    (await call(tokens.access_token, 'list_projects')).structuredContent.projects,
  ).toHaveLength(2);
  expect((await call(tokens.access_token, 'list_stocks', { q: 'test' })).isError).not.toBe(true);
  const id = (await list()).connections[0].id;
  const body = {
    client_name: '仕事のChatGPT',
    project_id: 'alice-project',
    scopes: ['projects:read', 'offline_access'],
  };
  expect((await update(id, body)).status).toBe(200);
  expect((await list()).connections[0]).toMatchObject(body);
  const result = await call(tokens.access_token, 'list_projects');
  expect(result.structuredContent.projects.map((project: { id: string }) => project.id)).toEqual([
    'alice-project',
  ]);
  expect((await call(tokens.access_token, 'list_stocks', { q: 'test' })).isError).toBe(true);
  const refresh = () =>
    request('/oauth/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token!,
        client_id: tokens.client_id,
        resource: `${app.env.APP_URL}/mcp`,
      }),
    });
  const refreshed = await refresh();
  expect(refreshed.status).toBe(200);
  const next = (await refreshed.json()) as { access_token: string; refresh_token: string };
  expect((await call(next.access_token, 'list_projects')).structuredContent.projects).toHaveLength(
    1,
  );
  expect((await call(next.access_token, 'list_stocks', { q: 'test' })).isError).toBe(true);
  expect((await update(id, { ...body, scopes: ['projects:read'] })).status).toBe(200);
  tokens.refresh_token = next.refresh_token;
  const denied = await refresh();
  expect(denied.status).toBe(400);
  expect(await denied.json()).toMatchObject({ error: 'invalid_scope' });
  expect((await list()).connections).toHaveLength(1);
  expect((await update(id, body)).status).toBe(200);
  expect((await refresh()).status).toBe(200);
  // Deleting a selected project must never turn its restriction into all projects.
  await app.env.DB.prepare('DELETE FROM projects WHERE id=?').bind('alice-project').run();
  expect(
    (
      await request('/mcp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${next.access_token}`,
          Host: new URL(app.env.APP_URL).host,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'list_projects', arguments: {} },
        }),
      })
    ).status,
  ).toBe(403);
});
it('他人・CSRF・不正な入力・未認可の権限追加を拒否し設定を維持する', async () => {
  await mcpTokens(app, null, ['projects:read']);
  const id = (await list()).connections[0].id;
  const body = { client_name: 'My app', project_id: null, scopes: ['projects:read'] };
  expect((await update(id, body, { ...session, Cookie: 'stock_session=bob-session' })).status).toBe(
    404,
  );
  expect((await update(id, body, { ...session, Origin: 'https://evil.example' })).status).toBe(403);
  expect((await update(id, { ...body, project_id: 'bob-project' })).status).toBe(404);
  for (const invalid of [
    { client_name: ' ' },
    { client_name: 'x'.repeat(101) },
    { scopes: ['stocks:write'] },
    { scopes: ['unknown'] },
    { project_id: 42 },
  ]) {
    expect((await update(id, { ...body, ...invalid })).status).toBe(400);
  }
  expect((await list()).connections[0].client_name).toBe('MCP integration test');
  expect((await update(id, { ...body, scopes: [] })).status).toBe(200);
  expect((await update(id, body)).status).toBe(200);
  expect(
    (await request(`/api/v1/mcp/connections/${id}`, { method: 'DELETE', headers: session })).status,
  ).toBe(200);
  expect(
    (await app.env.DB.prepare('SELECT revoked,scopes FROM mcp_connection_settings').all()).results,
  ).toEqual([{ revoked: 1, scopes: '[]' }]);
});

it('認証済みリクエストと解除が競合しても元の権限に戻さない', async () => {
  const tokens = await mcpTokens(app, null, ['projects:read', 'stocks:read']);
  const id = (await list()).connections[0].id;
  expect(
    (await update(id, { client_name: 'Restricted', project_id: 'alice-project', scopes: [] }))
      .status,
  ).toBe(200);
  const provider = app.env.OAUTH_PROVIDER!;
  const unwrap = provider.unwrapToken.bind(provider);
  let signalAuthenticated!: () => void;
  let resume!: () => void;
  const authenticated = new Promise<void>((resolve) => {
    signalAuthenticated = resolve;
  });
  const resumed = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const spy = vi.spyOn(provider, 'unwrapToken').mockImplementation(async (token) => {
    const result = await unwrap(token);
    signalAuthenticated();
    await resumed;
    return result;
  });
  try {
    const pending = request('/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Host: new URL(app.env.APP_URL).host,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'list_projects', arguments: {} },
      }),
    });
    await authenticated;
    expect(
      (await request(`/api/v1/mcp/connections/${id}`, { method: 'DELETE', headers: session }))
        .status,
    ).toBe(200);
    resume();
    expect((await pending).status).toBe(401);
  } finally {
    resume();
    spy.mockRestore();
  }
});
