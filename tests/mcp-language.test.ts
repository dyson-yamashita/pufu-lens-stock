import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  CallToolResult,
  InitializeResult,
  ListToolsResult,
  ListResourcesResult,
  ReadResourceResult,
} from '@modelcontextprotocol/server';
import { parseHTML } from 'linkedom';
import worker from '../server/index';
import { testApp } from './helpers';
import { mcpToken } from './mcp-helpers';
import { pufuViewerUri } from '../shared/pufu-viewer';
import score from './fixtures/pufu-sparse.json';

describe('MCP account language', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  let id = 0;
  beforeEach(async () => {
    app = await testApp();
  });
  afterEach(async () => {
    await app.dispose();
  });
  async function rpc<T>(token: string, method: string, params: unknown = {}): Promise<T> {
    const requestId = ++id;
    const response = await worker.fetch(
      new Request(`${app.env.APP_URL}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Host: new URL(app.env.APP_URL).host,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
      }),
      app.env,
      // Each fetch has its own execution context in Workers. OAuth attaches
      // request-specific props/auth to it, including during concurrent calls.
      Object.create(app.ctx),
    );
    expect(response.status).toBe(200);
    const messages = response.headers.get('Content-Type')?.includes('application/json')
      ? [await response.json()]
      : (await response.text())
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => JSON.parse(line.slice(6)));
    return messages.find((message) => message.id === requestId).result;
  }
  const call = (token: string, name: string, args: unknown = {}) =>
    rpc<CallToolResult & { structuredContent: Record<string, unknown> }>(token, 'tools/call', {
      name,
      arguments: args,
    });
  it('concurrent principals retain localized catalogs, instructions and guideline structure', async () => {
    await app.env.DB.prepare("UPDATE users SET language='en' WHERE id='alice'").run();
    const en = await mcpToken(app, null, ['questions:read', 'pufus:write']);
    const ja = await mcpToken(app, null, ['questions:read'], 'bob');
    const [enTools, jaTools, enGuide, jaGuide] = await Promise.all([
      rpc<ListToolsResult>(en, 'tools/list'),
      rpc<ListToolsResult>(ja, 'tools/list'),
      call(en, 'get_pufu_guideline'),
      call(ja, 'get_pufu_guideline'),
    ]);
    expect(enTools.tools.map((t) => t.name)).toEqual(jaTools.tools.map((t) => t.name));
    const [enResources, jaResources] = await Promise.all([
      rpc<ListResourcesResult>(en, 'resources/list'),
      rpc<ListResourcesResult>(ja, 'resources/list'),
    ]);
    expect(enResources.resources.map(({ uri, name }) => ({ uri, name }))).toEqual(
      jaResources.resources.map(({ uri, name }) => ({ uri, name })),
    );
    expect(enResources.resources[0]).toMatchObject({
      name: 'プ譜ビューアー',
      title: 'Pufu viewer',
      uri: pufuViewerUri,
    });
    expect(enTools.tools.find((t) => t.name === 'get_pufu')?.title).toBe('Get pufu');
    expect(jaTools.tools.find((t) => t.name === 'get_pufu')?.title).toBe('プ譜取得');
    expect(JSON.stringify(enTools.tools)).not.toMatch(/[\u3040-\u30ff\u3400-\u9fff]/u);
    expect(enGuide.structuredContent).toMatchObject({
      language: 'en',
      guidelines: { gainingGoal: { label: 'Gaining goal' } },
    });
    expect(jaGuide.structuredContent).toMatchObject({ language: 'ja' });
    const shape = (value: unknown): unknown =>
      typeof value === 'string'
        ? 'string'
        : Array.isArray(value)
          ? value.map(shape)
          : value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]))
            : value;
    expect(shape(enGuide.structuredContent)).toEqual(shape(jaGuide.structuredContent));
    expect(enGuide.structuredContent?.sources).toEqual(jaGuide.structuredContent?.sources);
    const init = await rpc<InitializeResult>(en, 'initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(init.instructions).toContain('English');
    expect(init.instructions).toContain('existing');
    const missing = await call(en, 'get_pufu', { pufu_id: 'missing' });
    expect(missing.structuredContent).toMatchObject({ status: 404, error: expect.any(String) });
    expect(JSON.stringify(missing)).not.toMatch(/[\u3040-\u30ff\u3400-\u9fff]/u);
  });
  it('localizes schema validation per principal without mutating shared schemas', async () => {
    await app.env.DB.prepare("UPDATE users SET language='en' WHERE id='alice'").run();
    const en = await mcpToken(app, null, ['questions:write']);
    const ja = await mcpToken(app, null, ['questions:write'], 'bob');
    const args = {
      target_type: 'pufu',
      target_id: 'missing',
      body: '保存済みの文面',
      request_id: crypto.randomUUID(),
    };
    const [english, japanese] = await Promise.all([
      call(en, 'add_comment', args),
      call(ja, 'add_comment', args),
    ]);
    expect(english.isError).toBe(true);
    expect(JSON.stringify(english)).not.toMatch(/[\u3040-\u30ff\u3400-\u9fff]/u);
    expect(JSON.stringify(japanese)).toContain('プ譜には局面番号');
    const revision = await call(en, 'update_pufu', {
      pufu_id: 'missing',
      revision: 0,
      projectScore: score,
    });
    expect(revision.isError).toBe(true);
    expect(JSON.stringify(revision)).toContain('revision');
    expect(JSON.stringify(revision)).toMatch(/revision:.*(?:>0|>=1)/);
  });
  it('English presentation preserves raw saved score, comments and resource safety', async () => {
    const token = await mcpToken(app, 'alice-project', ['questions:read', 'pufus:write']);
    const created = await call(token, 'create_pufu', {
      project_id: 'alice-project',
      projectScore: score,
      request_id: crypto.randomUUID(),
    });
    const pufuId = (created.structuredContent?.pufu as { id: string }).id;
    const before = (await app.env.DB.prepare('SELECT * FROM pufu_scores').all()).results;
    await app.env.DB.prepare("UPDATE users SET language='en' WHERE id='alice'").run();
    const read = await call(token, 'get_pufu', { pufu_id: pufuId });
    expect(read.structuredContent?.projectScore).toEqual(score);
    const conflict = await call(token, 'update_pufu', {
      pufu_id: pufuId,
      revision: 999,
      projectScore: score,
    });
    expect(conflict.isError).toBe(true);
    expect(conflict.structuredContent).toMatchObject({ status: 409 });
    expect(JSON.stringify(conflict)).not.toMatch(/[\u3040-\u30ff\u3400-\u9fff]/u);
    expect((await app.env.DB.prepare('SELECT * FROM pufu_scores').all()).results).toEqual(before);
    const resource = await rpc<ReadResourceResult>(token, 'resources/read', { uri: pufuViewerUri });
    const html = 'text' in resource.contents[0] ? resource.contents[0].text : '';
    const { document } = parseHTML(html);
    expect(document.documentElement.lang).toBe('en');
    expect(document.querySelector('#retry')?.textContent).toBe('Refresh');
    expect(html).not.toContain('__PUFU_LANGUAGE__');
    expect(app.env.ARTICLE_WORKFLOW.create).not.toHaveBeenCalled();
  });
});
