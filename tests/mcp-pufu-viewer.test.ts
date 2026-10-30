import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import type {
  CallToolResult,
  ReadResourceResult,
  ListResourcesResult,
  ListToolsResult,
} from '@modelcontextprotocol/server';
import worker from '../server/index';
import { testApp } from './helpers';
import { mcpToken } from './mcp-helpers';
import { pufuViewerSchema, pufuViewerUri } from '../shared/pufu-viewer';
import * as renderer from '../server/pufu-renderer';
import score from './fixtures/pufu-sparse.json';

const font = readFile(new URL('../public/fonts/pufu-jp.otf', import.meta.url));
describe('MCP Appsのプ譜表示', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  let token: string;
  let id = 0;
  beforeEach(async () => {
    app = await testApp();
    token = await mcpToken(app, 'alice-project');
    app.env.ASSETS = { fetch: async () => new Response(await font) } as unknown as Fetcher;
    await app.env.DB.batch([
      app.env.DB.prepare(`INSERT INTO questions(id,project_id,text,source,status) VALUES
        ('viewer-q','alice-project','表示確認','user','ready'),
        ('empty-q','alice-project','未作成','user','ready'),
        ('second-q','alice-second','別プロジェクト','user','ready'),
        ('bob-q','bob-project','別ユーザー','user','ready')`),
      ...[
        ['viewer-p', 'viewer-q', 'alice', 'ready'],
        ['queued-p', 'viewer-q', 'alice', 'generating'],
        ['second-p', 'second-q', 'alice', 'ready'],
        ['bob-p', 'bob-q', 'bob', 'ready'],
      ].map(([p, q, user, status]) =>
        app.env.DB.prepare(
          `INSERT INTO pufu_scores(id,user_id,question_id,task,input_json,score_json,editor_version,status)
          VALUES(?,?,?,'課題','{}',?,'0.9.15',?)`,
        ).bind(p, user, q, JSON.stringify(score), status),
      ),
    ]);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app.dispose();
  });
  async function rpc<T>(method: string, params: unknown = {}, accessToken = token): Promise<T> {
    const requestId = ++id;
    const response = await worker.fetch(
      new Request(`${app.env.APP_URL}/mcp`, {
        method: 'POST',
        headers: {
          Host: new URL(app.env.APP_URL).host,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
      }),
      app.env,
      app.ctx,
    );
    expect(response.status).toBe(200);
    const messages = response.headers.get('Content-Type')?.includes('application/json')
      ? [await response.json()]
      : (await response.text())
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => JSON.parse(line.slice(6)));
    return messages.find((message) => message.id === requestId).result as T;
  }
  const call = (
    name: string,
    args: unknown = { question_id: 'viewer-q', pufu_id: 'viewer-p' },
    accessToken = token,
  ) => rpc<CallToolResult>('tools/call', { name, arguments: args }, accessToken);
  const open = (url: string) =>
    app.request(new URL(url).pathname, { headers: { Cookie: '', Origin: '' } });

  it('HTMLリソース・CSP・出力スキーマを公開し、再取得ツールは新しいカードを作らない', async () => {
    const resources = await rpc<ListResourcesResult>('resources/list');
    expect(resources.resources).toContainEqual(
      expect.objectContaining({ uri: pufuViewerUri, mimeType: 'text/html;profile=mcp-app' }),
    );
    const resource = await rpc<ReadResourceResult>('resources/read', { uri: pufuViewerUri });
    expect(resource.contents[0]).toMatchObject({
      mimeType: 'text/html;profile=mcp-app',
      _meta: { ui: { csp: { resourceDomains: [app.env.APP_URL], connectDomains: [] } } },
    });
    const html = 'text' in resource.contents[0] ? resource.contents[0].text : '';
    expect(html).toContain('data-image-origin="http://localhost:5173"');
    expect(html).not.toMatch(/<script\s+src=/i);
    const script = /<script>([\s\S]*?)<\/script>/i.exec(html)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Script(script!)).not.toThrow();
    const { tools } = await rpc<ListToolsResult>('tools/list');
    expect(tools.find((tool) => tool.name === 'show_pufu')).toMatchObject({
      _meta: {
        ui: { resourceUri: pufuViewerUri, visibility: ['model'] },
        securitySchemes: [{ type: 'oauth2', scopes: ['questions:read'] }],
      },
      outputSchema: { type: 'object', properties: { image_url: {}, expires_at: {}, pufu_id: {} } },
    });
    const refresh = tools.find((tool) => tool.name === 'get_pufu_image')!;
    expect(refresh._meta).toMatchObject({ ui: { visibility: ['model', 'app'] } });
    expect(refresh._meta?.ui).not.toHaveProperty('resourceUri');
  });
  it('指定したプ譜のPNGを1回生成して表示データを返し、既存JSON・Base64取得も維持する', async () => {
    const render = vi.spyOn(renderer, 'renderSavedPufu');
    const before = (await app.env.DB.prepare('SELECT * FROM pufu_scores').all()).results;
    const output = await call('show_pufu');
    expect(output.isError).not.toBe(true);
    const data = pufuViewerSchema.parse(output.structuredContent);
    expect(data).toMatchObject({
      status: 'ready',
      question_id: 'viewer-q',
      pufu_id: 'viewer-p',
      title: score.gainingGoal.text,
      phase: 1,
      revision: 1,
    });
    expect(output.content.some((item) => item.type === 'image')).toBe(false);
    expect((await open(data.image_url!)).status).toBe(200);
    expect(render).toHaveBeenCalledTimes(1);
    expect((await app.env.DB.prepare('SELECT * FROM pufu_scores').all()).results).toEqual(before);
    expect(app.env.ARTICLE_WORKFLOW.create).not.toHaveBeenCalled();
    const json = await call('get_pufu');
    expect(json.structuredContent).toMatchObject({ projectScore: score });
    const image = await call('get_pufu_image');
    expect(image.content).toContainEqual(
      expect.objectContaining({ type: 'image', mimeType: 'image/png', data: expect.any(String) }),
    );
    expect(image.structuredContent).toMatchObject({
      status: 'ready',
      pufu_id: 'viewer-p',
      image_url: expect.any(String),
      download_url: expect.any(String),
      expires_at: expect.any(String),
    });
  });
  it('threads the account language into PNG presentation and viewer metadata with the same signed lifetime', async () => {
    await app.env.DB.prepare("UPDATE users SET language='en' WHERE id='alice'").run();
    const render = vi.spyOn(renderer, 'renderSavedPufu');
    const before = (await app.env.DB.prepare('SELECT * FROM pufu_scores').all()).results;
    const output = await call('show_pufu');
    const data = pufuViewerSchema.parse(output.structuredContent);
    expect(data).toMatchObject({ language: 'en', title: score.gainingGoal.text, status: 'ready' });
    expect(render).toHaveBeenCalledExactlyOnceWith(app.env, score, 'en');
    const image = await render.mock.results[0].value;
    expect(image.svg).toContain('Eight planning elements');
    expect(image.svg).not.toContain('廟算八要素');
    expect(Math.abs(Date.parse(data.expires_at!) - Date.now() - 3_600_000)).toBeLessThan(5000);
    expect((await open(data.image_url!)).status).toBe(200);
    expect((await app.env.DB.prepare('SELECT * FROM pufu_scores').all()).results).toEqual(before);
  });
  it('未作成を成功画像と区別する', async () => {
    const output = await call('show_pufu', { question_id: 'empty-q' });
    expect(output.isError).not.toBe(true);
    expect(pufuViewerSchema.parse(output.structuredContent)).toMatchObject({
      status: 'not_created',
      pufu_id: null,
      image_url: null,
    });
    expect(await app.env.DB.prepare('SELECT * FROM pufu_image_links').first()).toBeNull();
  });
  it.each([
    ['viewer-q', 'missing', 404],
    ['viewer-q', 'second-p', 404],
    ['second-q', 'second-p', 404],
    ['bob-q', 'bob-p', 404],
    ['viewer-q', 'queued-p', 409],
  ])('権限・紐づき・生成状態を再確認する %s/%s', async (questionId, pufuId, status) => {
    const output = await call('show_pufu', { question_id: questionId, pufu_id: pufuId });
    expect(output.isError).toBe(true);
    expect(output.structuredContent).toMatchObject({ status });
    expect(await app.env.DB.prepare('SELECT * FROM pufu_image_links').first()).toBeNull();
  });
  it('OAuthの閲覧スコープ不足では画像URLを発行しない', async () => {
    const restricted = await mcpToken(app, 'alice-project', ['projects:read']);
    expect((await call('show_pufu', undefined, restricted)).structuredContent).toMatchObject({
      status: 403,
    });
    expect(await app.env.DB.prepare('SELECT * FROM pufu_image_links').first()).toBeNull();
  });
  it('URL発行失敗はshow_pufuではエラー、既存get_pufu_imageではBase64を維持する', async () => {
    const content = app.env.CONTENT;
    app.env.CONTENT = new Proxy(content, {
      get: (target, key) =>
        key === 'put'
          ? async () => {
              throw new Error('SECRET_R2');
            }
          : Reflect.get(target, key),
    });
    const show = await call('show_pufu');
    expect(show.isError).toBe(true);
    expect(show.structuredContent).toMatchObject({ status: 503 });
    expect(JSON.stringify(show)).not.toContain('SECRET_');
    const legacy = await call('get_pufu_image');
    expect(legacy.isError).not.toBe(true);
    expect(legacy.content).toContainEqual(expect.objectContaining({ type: 'image' }));
  });
  it('期限切れ・更新後は同じIDの最新画像を取得し、削除後は再発行しない', async () => {
    const initial = pufuViewerSchema.parse((await call('show_pufu')).structuredContent);
    await app.env.DB.prepare("UPDATE pufu_image_links SET expires_at='2000-01-01T00:00:00Z'").run();
    expect((await open(initial.image_url!)).status).toBe(404);
    const newer = structuredClone(score);
    newer.gainingGoal.text = '更新した獲得目標';
    await app.env.DB.prepare("UPDATE pufu_scores SET score_json=?,revision=2 WHERE id='viewer-p'")
      .bind(JSON.stringify(newer))
      .run();
    const refreshed = await call('get_pufu_image');
    expect(refreshed.structuredContent).toMatchObject({
      pufu_id: 'viewer-p',
      revision: 2,
      title: newer.gainingGoal.text,
    });
    await app.env.DB.prepare("DELETE FROM pufu_scores WHERE id='viewer-p'").run();
    const before = await app.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM pufu_image_links',
    ).first();
    const missing = await call('get_pufu_image');
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent).toMatchObject({ status: 404 });
    expect(
      await app.env.DB.prepare('SELECT COUNT(*) AS count FROM pufu_image_links').first(),
    ).toEqual(before);
  });
});
