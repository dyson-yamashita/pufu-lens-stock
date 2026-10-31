import score from './fixtures/pufu-sparse.json';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import worker from '../server/index';
import { testApp, applyMigration } from './helpers';
import { readdir } from 'node:fs/promises';
import { searchBindings, searchStock } from './search-helpers';
import { syncSearchIndex } from '../server/search-index';
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
    connections: {
      id: string;
      client_name: string;
      project_id: string | null;
      project_ids: string[] | null;
      scopes: string[];
    }[];
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

it('複数許可を初回認可・既存トークン・一覧と詳細・書き込みに適用する', async () => {
  await app.env.DB.prepare(
    "INSERT INTO projects(id,user_id,name) VALUES ('alice-third','alice','Third')",
  ).run();
  await app.env.DB.prepare("UPDATE projects SET show_in_all_lists=0 WHERE id='alice-second'").run();
  const scopes = [
    'projects:read',
    'stocks:read',
    'stocks:write',
    'questions:read',
    'questions:write',
    'pufus:write',
    'offline_access',
  ];
  const tokens = await mcpTokens(app, ['alice-project', 'alice-second'], scopes);
  const id = (await list()).connections[0].id;
  expect((await list()).connections[0].project_ids).toEqual(['alice-project', 'alice-second']);
  const pufus: string[] = [];
  for (const [index, project] of ['alice-project', 'alice-second', 'alice-third'].entries()) {
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO articles(id,user_id,canonical_url,source_url,title,domain,status) VALUES (?,'alice',?,?,?,'example.com','ready')",
      ).bind(
        `a${index}`,
        `https://example.com/${index}`,
        `https://example.com/${index}`,
        `Item ${index}`,
      ),
      app.env.DB.prepare(
        "INSERT INTO stocks(id,user_id,project_id,article_id) VALUES (?,'alice',?,?)",
      ).bind(`s${index}`, project, `a${index}`),
      app.env.DB.prepare(
        "INSERT INTO questions(id,project_id,source,text,status) VALUES (?,?,'user',?,'ready')",
      ).bind(`q${index}`, project, `Question ${index}`),
    ]);
    const created = await app.request('/api/v1/pufus', {
      method: 'POST',
      body: { project_id: project, request_id: crypto.randomUUID(), score },
    });
    expect(created.status).toBe(201);
    pufus.push(((await created.json()) as { pufu: { id: string } }).pufu.id);
  }
  const projects = (await call(tokens.access_token, 'list_projects')).structuredContent
    .projects as { id: string }[];
  expect(projects.map((project) => project.id).sort()).toEqual(['alice-project', 'alice-second']);
  for (const [tool, key] of [
    ['list_stocks', 'stocks'],
    ['list_questions', 'questions'],
    ['list_pufus', 'pufus'],
  ]) {
    const result = (await call(tokens.access_token, tool)).structuredContent;
    expect(result.total).toBe(2);
    expect((result[key] as { project_id: string }[]).map((row) => row.project_id).sort()).toEqual([
      'alice-project',
      'alice-second',
    ]);
    expect((await call(tokens.access_token, tool, { project_id: 'alice-third' })).isError).toBe(
      true,
    );
  }
  for (const index of [0, 1, 2]) {
    const calls = [
      ['get_stock', { stock_id: `s${index}`, include_content: true }],
      ['get_question', { question_id: `q${index}` }],
      ['get_pufu', { pufu_id: pufus[index] }],
      [
        'add_comment',
        {
          target_type: 'stock',
          target_id: `s${index}`,
          body: 'Comment',
          request_id: crypto.randomUUID(),
        },
      ],
      ['list_comments', { target_type: 'stock', target_id: `s${index}` }],
      ['update_pufu', { pufu_id: pufus[index], revision: 1, projectScore: score }],
      ['add_pufu_phase', { pufu_id: pufus[index], revision: 2, request_id: crypto.randomUUID() }],
      [
        'create_pufu',
        {
          project_id: ['alice-project', 'alice-second', 'alice-third'][index],
          projectScore: score,
          request_id: crypto.randomUUID(),
        },
      ],
    ] as const;
    for (const [tool, args] of calls) {
      const result = await call(tokens.access_token, tool, args);
      if (index === 2) {
        expect(result.isError, tool).toBe(true);
        expect(result.structuredContent.status, tool).toBe(404);
      } else expect(result.isError, `${tool}: ${JSON.stringify(result)}`).not.toBe(true);
    }
  }
  expect(
    (await call(tokens.access_token, 'show_pufu', { pufu_id: pufus[2] })).structuredContent.status,
  ).toBe(404);
  const saved = { client_name: 'Multi', scopes, project_ids: ['alice-second', 'alice-third'] };
  expect((await update(id, saved)).status).toBe(200);
  expect((await call(tokens.access_token, 'get_stock', { stock_id: 's0' })).isError).toBe(true);
  expect((await call(tokens.access_token, 'get_stock', { stock_id: 's2' })).isError).not.toBe(true);
  for (const project_ids of [[], ['bob-project'], ['alice-second', 'missing']])
    expect((await update(id, { ...saved, project_ids })).status).toBe(
      project_ids.length ? 404 : 400,
    );
  await app.env.DB.prepare("DELETE FROM projects WHERE id='alice-second'").run();
  expect(
    (await call(tokens.access_token, 'list_projects')).structuredContent.projects.map(
      (p: { id: string }) => p.id,
    ),
  ).toEqual(['alice-third']);
  expect((await update(id, { ...saved, project_ids: null })).status).toBe(200);
  expect(
    (await call(tokens.access_token, 'list_projects')).structuredContent.projects,
  ).toHaveLength(2);
});

it('意味検索・hybridの候補と総数にも複数プロジェクト制限を適用する', async () => {
  await app.env.DB.prepare(
    "INSERT INTO projects(id,user_id,name) VALUES ('alice-third','alice','Third')",
  ).run();
  const bindings = searchBindings(app.env);
  for (let index = 0; index < 100; index++)
    bindings.vectors.set(`outside-${index}`, {
      id: `outside-${index}`,
      namespace: 'alice',
      metadata: { project_id: 'alice-third' },
      values: bindings.values,
    });
  await searchStock(app, 'one', { project: 'alice-project' });
  await searchStock(app, 'two', { project: 'alice-second' });
  await searchStock(app, 'outside', { project: 'alice-third' });
  await syncSearchIndex(app.env);
  const tokens = await mcpTokens(app, ['alice-project', 'alice-second'], ['stocks:read']);
  for (const mode of ['semantic', 'hybrid']) {
    const result = await call(tokens.access_token, 'list_stocks', {
      q: 'コードレビュー',
      mode,
      limit: 1,
    });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(result.structuredContent.total).toBe(2);
    expect(result.structuredContent.stocks).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('s-outside');
    expect(result.structuredContent.search.mode).toBe(mode);
    expect(result.structuredContent.search.candidates_truncated).toBe(false);
  }
});
it('旧単一プロジェクト設定を移行し、全件と解除済みの状態を維持する', async () => {
  await app.dispose();
  const migrations = (await readdir(new URL('../migrations/', import.meta.url)))
    .filter((name) => name.endsWith('.sql') && name !== '0038_mcp_multiple_projects.sql')
    .sort();
  app = await testApp({ migrations });
  await app.env.DB.batch([
    app.env.DB.prepare(
      "INSERT INTO mcp_connection_settings(user_id,grant_id,client_name,project_id,scopes) VALUES ('alice','single','App','alice-project','[]')",
    ),
    app.env.DB.prepare(
      "INSERT INTO mcp_connection_settings(user_id,grant_id,client_name,project_id,scopes) VALUES ('alice','all','App',NULL,'[]')",
    ),
    app.env.DB.prepare(
      "INSERT INTO mcp_connection_settings(user_id,grant_id,client_name,project_id,scopes,revoked) VALUES ('alice','revoked','App','alice-project','[]',1)",
    ),
  ]);
  await applyMigration(app.env.DB, '0038_mcp_multiple_projects.sql');
  expect(
    (
      await app.env.DB.prepare(
        'SELECT grant_id,project_ids,revoked FROM mcp_connection_settings ORDER BY grant_id',
      ).all()
    ).results,
  ).toEqual([
    { grant_id: 'all', project_ids: null, revoked: 0 },
    { grant_id: 'revoked', project_ids: '["alice-project"]', revoked: 1 },
    { grant_id: 'single', project_ids: '["alice-project"]', revoked: 0 },
  ]);
});
