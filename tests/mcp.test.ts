import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../server/index';
import { testApp } from './helpers';
import { mcpToken } from './mcp-helpers';

type Result = {
  result: {
    isError?: boolean;
    structuredContent: Record<string, unknown>;
    tools?: { name: string; annotations: { readOnlyHint: boolean } }[];
  };
};
describe('MCPによるストックと問いの取得・追加', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
  });
  afterEach(async () => {
    await app.dispose();
  });
  let id = 0;
  async function rpc(token: string, method: string, params: unknown = {}) {
    const response = await worker.fetch(
      new Request(`${app.env.APP_URL}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Host: new URL(app.env.APP_URL).host,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
      }),
      app.env,
      app.ctx,
    );
    expect(response.status, response.status === 200 ? '' : await response.clone().text()).toBe(200);
    if (response.headers.get('Content-Type')?.includes('application/json'))
      return (await response.json()) as Result;
    const messages = (await response.text())
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)) as Result & { id?: number });
    return messages.find((message) => message.id === id)!;
  }
  const call = (token: string, name: string, args: unknown = {}) =>
    rpc(token, 'tools/call', { name, arguments: args });
  it('初期化・ツール列挙・検索・URL/テキスト保存・独立した問いの追加と再送が動く', async () => {
    const token = await mcpToken(app, 'alice-project');
    const initialized = await rpc(token, 'initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(initialized.result).toHaveProperty('serverInfo');
    const listed = await rpc(token, 'tools/list');
    expect(listed.result.tools?.map((tool) => tool.name).sort()).toEqual([
      'add_question',
      'add_stock',
      'get_question',
      'get_stock',
      'list_projects',
      'list_questions',
      'list_stocks',
    ]);
    expect(
      listed.result.tools?.find((tool) => tool.name === 'get_stock')?.annotations.readOnlyHint,
    ).toBe(true);
    expect(listed.result.tools?.find((tool) => tool.name === 'add_question')).toHaveProperty(
      'securitySchemes',
      [{ type: 'oauth2', scopes: ['questions:write'] }],
    );
    expect(listed.result.tools?.find((tool) => tool.name === 'get_stock')).toHaveProperty(
      'inputSchema.required',
      ['stock_id'],
    );
    const projects = await call(token, 'list_projects');
    expect(projects.result.structuredContent.projects).toEqual([
      expect.objectContaining({ id: 'alice-project' }),
    ]);
    const input = {
      type: 'text',
      project_id: 'alice-project',
      title: 'MCPの検討',
      text: '会話から保存した本文',
      request_id: crypto.randomUUID(),
    };
    const saved = await call(token, 'add_stock', input);
    expect(saved.result.isError).not.toBe(true);
    const stockId = saved.result.structuredContent.id;
    expect((await call(token, 'add_stock', input)).result.structuredContent).toMatchObject({
      id: stockId,
      duplicate: true,
    });
    const detail = (await call(token, 'get_stock', { stock_id: stockId, include_content: true }))
      .result.structuredContent;
    expect(detail.content).toBe('会話から保存した本文');
    expect((await call(token, 'list_stocks', { q: 'MCP' })).result.structuredContent.total).toBe(1);
    expect(
      (
        await call(token, 'add_stock', {
          type: 'url',
          project_id: 'alice-project',
          url: 'https://example.com/mcp',
          request_id: crypto.randomUUID(),
        })
      ).result.isError,
    ).not.toBe(true);
    const questionInput = {
      project_id: 'alice-project',
      text: '会話から問いを保存できるか？',
      request_id: crypto.randomUUID(),
    };
    const question = (await call(token, 'add_question', questionInput)).result.structuredContent
      .question as { id: string };
    expect(
      (await call(token, 'add_question', questionInput)).result.structuredContent.question,
    ).toMatchObject({ id: question.id });
    expect(
      (await call(token, 'get_question', { question_id: question.id })).result.structuredContent
        .question,
    ).toMatchObject({ stock_id: null });
    expect(
      (await call(token, 'list_questions', { q: '会話' })).result.structuredContent.total,
    ).toBe(1);
  });
  it('ID指定・検索・追加のどれも許可プロジェクト外と他ユーザーを拒否する', async () => {
    const otherStock = await app.request('/api/v1/stocks', {
      method: 'POST',
      body: { project_id: 'alice-second', url: 'https://example.com/private' },
    });
    const stockId = ((await otherStock.json()) as { id: string }).id;
    const otherQuestion = await app.request('/api/v1/questions', {
      method: 'POST',
      body: { project_id: 'alice-second', text: '非公開の問い' },
    });
    const questionId = ((await otherQuestion.json()) as { question: { id: string } }).question.id;
    const token = await mcpToken(app, 'alice-project');
    for (const [name, args] of [
      ['list_stocks', { project_id: 'alice-second' }],
      ['list_questions', { project_id: 'bob-project' }],
      ['get_stock', { stock_id: stockId, include_content: true }],
      ['get_question', { question_id: questionId }],
      [
        'add_question',
        { project_id: 'alice-second', text: '禁止', request_id: crypto.randomUUID() },
      ],
      [
        'add_question',
        {
          project_id: 'alice-project',
          stock_id: stockId,
          text: '不一致',
          request_id: crypto.randomUUID(),
        },
      ],
      [
        'add_stock',
        {
          type: 'url',
          project_id: 'bob-project',
          url: 'https://example.com/a',
          request_id: crypto.randomUUID(),
        },
      ],
    ] as const)
      expect((await call(token, name, args)).result.isError, name).toBe(true);
    expect((await call(token, 'list_stocks')).result.structuredContent.total).toBe(0);
    expect((await call(token, 'list_questions')).result.structuredContent.total).toBe(0);
  });
  it('読み取り専用の認可では追加できず、CookieやショートカットトークンもMCPでは使えない', async () => {
    const token = await mcpToken(app, null, ['projects:read', 'stocks:read', 'questions:read']);
    expect((await call(token, 'list_projects')).result.isError).not.toBe(true);
    const denied = await call(token, 'add_question', {
      project_id: 'alice-project',
      text: '許可なし',
      request_id: crypto.randomUUID(),
    });
    expect(denied.result.isError).toBe(true);
    expect(denied.result).toHaveProperty('_meta');
    expect(
      (
        await worker.fetch(
          new Request(`${app.env.APP_URL}/mcp`, {
            headers: { Cookie: 'stock_session=alice-session' },
          }),
          app.env,
          app.ctx,
        )
      ).status,
    ).toBe(401);
    const issued = await app.request('/api/v1/tokens', {
      method: 'POST',
      body: { name: 'shortcut' },
    });
    const shortcut = ((await issued.json()) as { token: string }).token;
    expect(
      (
        await worker.fetch(
          new Request(`${app.env.APP_URL}/mcp`, {
            headers: { Authorization: `Bearer ${shortcut}` },
          }),
          app.env,
          app.ctx,
        )
      ).status,
    ).toBe(401);
  });
});
