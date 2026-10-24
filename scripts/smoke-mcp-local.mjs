import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID, createHash } from 'node:crypto';
import { URL, URLSearchParams } from 'node:url';

const base = process.env.SMOKE_BASE_URL ?? 'http://localhost:5173';
assert.equal(
  (await (await fetch(`${base}/api/config`)).json()).demo,
  true,
  'ローカルデモ専用の検証です。',
);
const login = await fetch(`${base}/api/auth/demo`, { method: 'POST', headers: { Origin: base } });
assert.equal(login.status, 200);
const cookie = login.headers
  .getSetCookie()
  .find((value) => value.startsWith('stock_session='))
  .split(';')[0];
const session = { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' };
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: session,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  assert.ok(response.ok, data.error ?? `${method} ${path}: ${response.status}`);
  return data;
}
let projectId;
let grantId;
try {
  projectId = (await api('/projects', 'POST', { name: 'MCP動作確認（一時データ）' })).id;
  const registered = await fetch(`${base}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'ローカルMCP動作確認',
      redirect_uris: [`${base}/mcp-smoke-callback`],
      token_endpoint_auth_method: 'none',
    }),
  });
  assert.equal(registered.status, 201);
  const { client_id } = await registered.json();
  const verifier = randomUUID().replaceAll('-', '').repeat(2);
  const scopes = [
    'projects:read',
    'stocks:read',
    'stocks:write',
    'questions:read',
    'questions:write',
    'offline_access',
  ];
  const params = new URLSearchParams({
    client_id,
    response_type: 'code',
    redirect_uri: `${base}/mcp-smoke-callback`,
    scope: scopes.join(' '),
    state: randomUUID(),
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    resource: `${base}/mcp`,
  });
  const page = await fetch(`${base}/oauth/authorize?${params}`, { headers: session });
  assert.equal(page.status, 200);
  const handle = /name="handle" value="([^"]+)"/.exec(await page.text())[1];
  const form = new URLSearchParams({ handle, decision: 'approve', project_id: projectId });
  scopes.forEach((scope) => form.append('scope', scope));
  const approved = await fetch(`${base}/oauth/authorize`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Origin: base,
      Cookie: `${cookie}; ${page.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ')}`,
    },
    body: form,
  });
  assert.equal(approved.status, 302, await approved.text());
  const callback = new URL(approved.headers.get('Location'));
  assert.equal(callback.searchParams.get('state'), params.get('state'));
  const exchange = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id,
      grant_type: 'authorization_code',
      code: callback.searchParams.get('code'),
      code_verifier: verifier,
      redirect_uri: `${base}/mcp-smoke-callback`,
      resource: `${base}/mcp`,
    }),
  });
  assert.equal(exchange.status, 200, await exchange.clone().text());
  const tokens = await exchange.json();
  grantId = (await api('/mcp/connections')).connections.find(
    (item) => item.project_id === projectId,
  ).id;
  let rpcId = 0;
  async function rpc(method, args) {
    const id = ++rpcId;
    const response = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params: args }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const raw = await response.text();
    const message = response.headers.get('Content-Type').includes('application/json')
      ? JSON.parse(raw)
      : raw
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => JSON.parse(line.slice(6)))
          .find((item) => item.id === id);
    assert.ok(!message.error, JSON.stringify(message.error));
    return message.result;
  }
  const call = (name, args = {}) => rpc('tools/call', { name, arguments: args });
  assert.ok(
    (
      await rpc('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'local-smoke', version: '1' },
      })
    ).serverInfo,
  );
  const toolNames = (await rpc('tools/list', {})).tools.map((tool) => tool.name);
  for (const name of [
    'list_projects',
    'get_pufu',
    'get_pufu_image',
    'show_pufu',
    'add_comment',
    'list_comments',
  ])
    assert.ok(toolNames.includes(name), `Missing tool: ${name}`);
  assert.deepEqual(
    (await call('list_projects')).structuredContent.projects.map((project) => project.id),
    [projectId],
  );
  const input = {
    project_id: projectId,
    type: 'text',
    title: 'MCPの動作確認',
    text: 'このテキストはローカルのMCP動作確認専用です。',
    request_id: randomUUID(),
  };
  const saved = await call('add_stock', input);
  assert.ok(!saved.isError, JSON.stringify(saved));
  assert.equal((await call('add_stock', input)).structuredContent.id, saved.structuredContent.id);
  assert.equal(
    (await call('get_stock', { stock_id: saved.structuredContent.id, include_content: true }))
      .structuredContent.content,
    input.text,
  );
  const compact = await call('list_stocks', {
    q: input.title,
    limit: 1,
    sort_by: 'created_at',
    order: 'desc',
  });
  assert.equal(compact.structuredContent.detail, 'compact');
  assert.equal(compact.structuredContent.pageSize, 1);
  assert.equal(compact.structuredContent.has_more, false);
  assert.equal(compact.structuredContent.stocks.length, 1);
  assert.equal(compact.structuredContent.stocks[0].id, saved.structuredContent.id);
  assert.ok(!('summary' in compact.structuredContent.stocks[0]));
  assert.ok(!('note' in compact.structuredContent.stocks[0]));
  assert.deepEqual(JSON.parse(compact.content[0].text), compact.structuredContent);
  const full = await call('list_stocks', { q: input.title, limit: 1, detail: 'full' });
  assert.equal(full.structuredContent.stocks[0].id, saved.structuredContent.id);
  assert.ok('summary' in full.structuredContent.stocks[0]);
  assert.ok('note' in full.structuredContent.stocks[0]);
  const compactBytes = Buffer.byteLength(JSON.stringify(compact));
  const fullBytes = Buffer.byteLength(JSON.stringify(full));
  assert.ok(compactBytes < fullBytes);
  console.log(`MCP一覧の応答量（1件）: compact=${compactBytes} bytes / full=${fullBytes} bytes`);
  assert.ok((await call('list_stocks', { limit: 0 })).isError);
  const question = await call('add_question', {
    project_id: projectId,
    text: 'ストックなしの問いを保存できるか？',
    request_id: randomUUID(),
  });
  assert.ok(!question.isError, JSON.stringify(question));
  assert.equal(question.structuredContent.question.stock_id, null);
  const pufu = await call('get_pufu', { question_id: question.structuredContent.question.id });
  assert.ok(!pufu.isError);
  assert.deepEqual(pufu.structuredContent, {
    question_id: question.structuredContent.question.id,
    project_id: projectId,
    updated_at: null,
    projectScore: null,
  });
  assert.equal(
    (await call('get_question', { question_id: question.structuredContent.question.id }))
      .structuredContent.question.text,
    'ストックなしの問いを保存できるか？',
  );
  assert.equal((await call('list_questions', { q: 'ストックなし' })).structuredContent.total, 1);
  assert.equal((await call('list_stocks', { q: 'MCPの動作確認' })).structuredContent.total, 1);
  const commentTarget = {
    target_type: 'question',
    target_id: question.structuredContent.question.id,
  };
  const commentInput = { ...commentTarget, body: 'AI連携の判断記録', request_id: randomUUID() };
  const addedComment = await call('add_comment', commentInput);
  assert.ok(!addedComment.isError, JSON.stringify(addedComment));
  assert.equal(addedComment.structuredContent.comment.author_kind, 'agent');
  assert.equal(
    (await call('add_comment', commentInput)).structuredContent.comment.id,
    addedComment.structuredContent.comment.id,
  );
  const webComments = await api(`/comments?${new URLSearchParams(commentTarget)}`);
  assert.deepEqual(
    webComments.comments.map((comment) => comment.body),
    [commentInput.body],
  );
  await api('/comments', 'POST', {
    ...commentTarget,
    body: 'Webからの追記',
    request_id: randomUUID(),
  });
  assert.deepEqual(
    (await call('list_comments', commentTarget)).structuredContent.comments.map(
      (comment) => comment.body,
    ),
    ['AI連携の判断記録', 'Webからの追記'],
  );
  const refreshed = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id,
      refresh_token: tokens.refresh_token,
      resource: `${base}/mcp`,
    }),
  });
  assert.equal(refreshed.status, 200);
  const { access_token: refreshedToken } = await refreshed.json();
  await api(`/mcp/connections/${grantId}`, 'DELETE');
  grantId = undefined;
  assert.equal(
    (await fetch(`${base}/mcp`, { headers: { Authorization: `Bearer ${refreshedToken}` } })).status,
    401,
  );
  console.log(
    'MCPローカル検証成功: OAuth・ツール一覧・プ譜取得・再送・独立した問い・トークン更新・連携解除',
  );
} finally {
  if (grantId) await api(`/mcp/connections/${grantId}`, 'DELETE');
  if (projectId) await api(`/projects/${projectId}`, 'DELETE');
}
