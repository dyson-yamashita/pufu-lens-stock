import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CallToolResult, ListToolsResult } from '@modelcontextprotocol/server';
import worker from '../server/index';
import { createApp } from '../server/api';
import type { Principal } from '../server/env';
import { testApp } from './helpers';
import { mcpToken } from './mcp-helpers';

describe('MCPのプロジェクトメモリ取得', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  let requestId = 0;
  beforeEach(async () => {
    app = await testApp();
  });
  afterEach(async () => {
    await app.dispose();
  });
  async function rpc<T>(token: string, method: string, params: unknown = {}): Promise<T> {
    const id = ++requestId;
    const response = await worker.fetch(
      new Request(`${app.env.APP_URL}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Host: new URL(app.env.APP_URL).host,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      }),
      app.env,
      Object.create(app.ctx),
    );
    expect(response.status).toBe(200);
    const messages = response.headers.get('Content-Type')?.includes('application/json')
      ? [await response.json()]
      : (await response.text())
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => JSON.parse(line.slice(6)));
    return messages.find((message) => message.id === id).result;
  }
  const call = (token: string, args: unknown = { project_id: 'alice-project' }) =>
    rpc<CallToolResult>(token, 'tools/call', { name: 'get_project_memory', arguments: args });

  it('保存済みの本文・構造化メモリと更新状況を変更せず取得する', async () => {
    const data = {
      interests: ['関心'],
      knowledge: [{ text: '保存済みの知識', articleIds: ['source-article'] }],
      questions: ['今後の問い'],
    };
    await app.env.DB.prepare(
      "INSERT INTO memories(id,user_id,project_id,revision,text,data_json,article_count,model) VALUES('project-alice-project','alice','alice-project',0,'保存済みメモリ',?,1,'test-model')",
    )
      .bind(JSON.stringify(data))
      .run();
    await app.env.DB.prepare(
      "INSERT INTO processing_jobs(id,user_id,kind,target_id,revision,status) VALUES('memory-update','alice','project_memory','alice-project',0,'running')",
    ).run();
    await app.env.DB.prepare("UPDATE users SET language='en' WHERE id='alice'").run();
    const token = await mcpToken(app, null, ['memories:read']);
    const response = await call(token);
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      memory: {
        project_id: 'alice-project',
        text: '保存済みメモリ',
        data,
        revision: 0,
        current_revision: 0,
        article_count: 1,
        model: 'test-model',
      },
      pending: true,
      error: null,
      coverage: {
        ready_count: 0,
        full_rebuild_reason: 'A full rebuild is needed because the generation language changed.',
      },
    });
    expect(JSON.parse((response.content[0] as { text: string }).text)).toEqual(
      response.structuredContent,
    );
    expect(await app.env.DB.prepare('SELECT text,data_json FROM memories').first()).toEqual({
      text: '保存済みメモリ',
      data_json: JSON.stringify(data),
    });
    expect(app.env.MEMORY_WORKFLOW.create).not.toHaveBeenCalled();
    const listed = await rpc<ListToolsResult>(token, 'tools/list');
    expect(listed.tools.find((tool) => tool.name === 'get_project_memory')).toMatchObject({
      annotations: { readOnlyHint: true },
      securitySchemes: [{ type: 'oauth2', scopes: ['memories:read'] }],
      inputSchema: { required: ['project_id'] },
    });
  });

  it('未生成のプロジェクトもnullと更新状態を返し、全体一覧に非表示でも取得できる', async () => {
    await app.env.DB.prepare(
      "UPDATE projects SET show_in_all_lists=0 WHERE id='alice-project'",
    ).run();
    const token = await mcpToken(app, ['alice-project', 'alice-second'], ['memories:read']);
    expect((await call(token)).structuredContent).toMatchObject({
      memory: null,
      pending: false,
      error: null,
      coverage: { ready_count: 0, reflected_count: 0 },
    });
  });

  it('既存の閲覧権限だけではメモリを取得できず、専用権限を要求する', async () => {
    const token = await mcpToken(app);
    const response = await call(token);
    expect(response.isError).toBe(true);
    expect(response.structuredContent).toMatchObject({ status: 403 });
    expect(response._meta?.['mcp/www_authenticate']).toEqual([
      expect.stringContaining('scope="memories:read"'),
    ]);
  });

  it('接続範囲外・他ユーザー・存在しないプロジェクトへのアクセスを拒否する', async () => {
    const limited = await mcpToken(app, 'alice-project', ['memories:read']);
    expect((await call(limited, { project_id: 'alice-second' })).structuredContent).toMatchObject({
      status: 403,
    });
    const all = await mcpToken(app, null, ['memories:read']);
    for (const project_id of ['bob-project', 'missing']) {
      const response = await call(all, { project_id });
      expect(response.isError).toBe(true);
      expect(response.structuredContent).toMatchObject({ status: 404 });
    }
  });

  it('プロジェクト指定を必須とし、ユーザー全体メモリへフォールバックしない', async () => {
    const token = await mcpToken(app, 'alice-project', ['memories:read']);
    expect((await call(token, {})).isError).toBe(true);
    expect((await call(token, { project_id: '' })).isError).toBe(true);
    const user = await app.env.DB.prepare("SELECT * FROM users WHERE id='alice'").first();
    const principal = { user, kind: 'mcp', tokenProjectId: 'alice-project' } as Principal;
    const api = createApp(principal);
    for (const [query, status] of [
      ['', 400],
      ['?project_id=bob-project', 403],
    ] as const) {
      const response = await api.request(
        `${app.env.APP_URL}/api/v1/memory${query}`,
        {},
        app.env,
        app.ctx,
      );
      expect(response.status).toBe(status);
    }
  });
});
