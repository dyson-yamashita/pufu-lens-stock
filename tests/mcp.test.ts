import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../server/index';
import { testApp } from './helpers';
import { mcpToken } from './mcp-helpers';
import { searchBindings } from './search-helpers';
import { syncSearchIndex } from '../server/search-index';

type Result = {
  result: {
    isError?: boolean;
    structuredContent: Record<string, unknown>;
    content?: { type: string; text: string }[];
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
  async function seedStock(
    name: string,
    savedAt: string,
    owner = 'alice',
    projectId = `${owner}-project`,
  ) {
    const summary = {
      overview: '😀'.repeat(210),
      keyPoints: ['要点だけの検索語'],
      topics: ['トピックだけの検索語'],
    };
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO articles (id,user_id,canonical_url,source_url,title,domain,source_type,input_text,status,summary_json) VALUES (?,?,?,'',?,'','text',?,'ready',?)",
      ).bind(
        name,
        owner,
        `text:${name}`,
        `MCP資料 ${name}`,
        '本文だけの検索語',
        JSON.stringify(summary),
      ),
      app.env.DB.prepare(
        'INSERT INTO stocks (id,user_id,project_id,article_id,note,is_favorite,created_at) VALUES (?,?,?,?,?,1,?)',
      ).bind(`stock-${name}`, owner, projectId, name, 'メモだけの検索語', savedAt),
    ]);
  }

  it('長い日本語のハイブリッド検索でもOAuthの読み取り権限と保存先の制限を維持する', async () => {
    const bindings = searchBindings(app.env);
    await seedStock('hybrid', '2026-10-20T00:00:00.000Z');
    await seedStock('outside', '2026-10-20T00:00:00.000Z', 'alice', 'alice-second');
    await syncSearchIndex(app.env);
    const token = await mcpToken(app, 'alice-project');
    const response = (
      await call(token, 'list_stocks', {
        q: 'AIエージェントの安全性と品質を保つ方法',
        mode: 'hybrid',
        limit: 1,
      })
    ).result;
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      stocks: [{ id: 'stock-hybrid' }],
      total: 1,
      search: { requested_mode: 'hybrid', mode: 'hybrid' },
      sort_by: 'relevance',
    });
    bindings.run.mockClear();
    const denied = (
      await call(token, 'list_stocks', { q: '関連', mode: 'semantic', project_id: 'alice-second' })
    ).result;
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent.status).toBe(403);
    expect(bindings.run).not.toHaveBeenCalled();
    const noRead = await mcpToken(app, 'alice-project', ['questions:read']);
    expect((await call(noRead, 'list_stocks', { q: '関連', mode: 'hybrid' })).result.isError).toBe(
      true,
    );
    expect(bindings.run).not.toHaveBeenCalled();
  });

  it('既定の一覧は短い抜粋だけを返し、必要な詳細と本文は明示して取得できる', async () => {
    await seedStock('only', '2026-10-17T00:00:00.000Z');
    const token = await mcpToken(app, 'alice-project');
    const response = (
      await call(token, 'list_stocks', { limit: 5, sort_by: 'created_at', order: 'desc' })
    ).result;
    const data = response.structuredContent as {
      stocks: Record<string, unknown>[];
      pageSize: number;
      detail: string;
    };
    expect(data).toMatchObject({
      pageSize: 5,
      detail: 'compact',
      sort_by: 'created_at',
      order: 'desc',
      has_more: false,
    });
    const stock = data.stocks[0];
    expect(stock).toEqual({
      id: 'stock-only',
      title: 'MCP資料 only',
      project_id: 'alice-project',
      project_name: 'Alice project',
      created_at: '2026-10-17T00:00:00.000Z',
      status: 'ready',
      summary_excerpt: '😀'.repeat(199) + '…',
      summary_truncated: true,
    });
    expect(response.content?.[0].type).toBe('text');
    expect(JSON.parse(response.content![0].text)).toEqual(data);
    const full = (await call(token, 'list_stocks', { detail: 'full' })).result
      .structuredContent as { stocks: Record<string, unknown>[] };
    expect(full.stocks[0]).toMatchObject({
      is_favorite: 1,
      note: 'メモだけの検索語',
      summary: { overview: '😀'.repeat(210), keyPoints: ['要点だけの検索語'] },
    });
    const detail = (await call(token, 'get_stock', { stock_id: 'stock-only' })).result
      .structuredContent;
    expect(detail.stock).toEqual(full.stocks[0]);
    expect(detail).not.toHaveProperty('content');
    expect(
      (await call(token, 'get_stock', { stock_id: 'stock-only', include_content: true })).result
        .structuredContent,
    ).toMatchObject({ content: '本文だけの検索語', content_truncated: false });
    const rest = (await (await app.request('/api/v1/stocks')).json()) as {
      stocks: unknown[];
      pageSize: number;
    };
    expect(rest.pageSize).toBe(24);
    expect(rest.stocks[0]).toEqual(full.stocks[0]);
  });

  it('件数・保存日時順・同時刻のID順でページを分割し、許可された保存先だけを返す', async () => {
    await seedStock('z', '2026-10-15T00:00:00.000Z');
    await seedStock('m', '2026-10-16T00:00:00.000Z');
    await seedStock('a', '2026-10-17T00:00:00.000Z');
    await seedStock('b', '2026-10-17T00:00:00.000Z');
    await seedStock('outside', '2026-10-19T00:00:00.000Z', 'alice', 'alice-second');
    await seedStock('bob', '2026-10-20T00:00:00.000Z', 'bob');
    const token = await mcpToken(app, 'alice-project');
    async function list(args = {}) {
      const data = (
        await call(token, 'list_stocks', {
          limit: 2,
          source: 'user',
          favorite: true,
          status: 'ready',
          ...args,
        })
      ).result.structuredContent as { stocks: { id: string }[] };
      return { ...data, ids: data.stocks.map((stock) => stock.id) };
    }
    expect(await list()).toMatchObject({
      ids: ['stock-b', 'stock-a'],
      total: 4,
      page: 1,
      pageSize: 2,
      has_more: true,
    });
    expect(await list({ page: 2 })).toMatchObject({
      ids: ['stock-m', 'stock-z'],
      total: 4,
      page: 2,
      pageSize: 2,
      has_more: false,
    });
    expect(await list({ limit: 1 })).toMatchObject({ ids: ['stock-b'], total: 4, pageSize: 1 });
    expect(await list({ order: 'asc' })).toMatchObject({ ids: ['stock-z', 'stock-m'], total: 4 });
    expect(await list({ order: 'asc', page: 2 })).toMatchObject({
      ids: ['stock-a', 'stock-b'],
      total: 4,
      has_more: false,
    });
  });

  it('軽量表示でも要点・メモを検索し、本文だけの語は検索対象にしない', async () => {
    await seedStock('search', '2026-10-17T00:00:00.000Z');
    const token = await mcpToken(app, 'alice-project');
    for (const q of ['MCP資料', '要点だけの検索語', 'トピックだけの検索語', 'メモだけの検索語'])
      expect(
        (await call(token, 'list_stocks', { q, limit: 1 })).result.structuredContent,
      ).toMatchObject({ total: 1, stocks: [{ id: 'stock-search' }] });
    expect(
      (await call(token, 'list_stocks', { q: '本文だけの検索語' })).result.structuredContent.total,
    ).toBe(0);
  });

  it.each([
    { limit: 0 },
    { limit: 25 },
    { limit: 1.5 },
    { sort_by: 'title' },
    { order: 'desc; DROP TABLE stocks' },
    { detail: 'unknown' },
  ])('不正な一覧オプションを拒否する: %j', async (args) => {
    const token = await mcpToken(app, 'alice-project');
    expect((await call(token, 'list_stocks', args)).result.isError).toBe(true);
  });

  it('軽量表示と詳細表示のどちらも読み取り権限を要求する', async () => {
    const token = await mcpToken(app, null, ['projects:read']);
    for (const detail of ['compact', 'full'])
      expect((await call(token, 'list_stocks', { detail, limit: 1 })).result).toMatchObject({
        isError: true,
        structuredContent: { status: 403 },
      });
  });

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
