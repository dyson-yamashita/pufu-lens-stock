import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { testApp } from './helpers';
import { generateQuestionPufuImage } from '../server/pufu-images';
import { issuePufuImageLink, cleanupExpiredPufuImageLinks } from '../server/pufu-image-links';
import * as renderer from '../server/pufu-renderer';
import type { Principal } from '../server/env';
import score from './fixtures/pufu-sparse.json';

const principal: Principal = {
  user: {
    id: 'alice',
    name: 'Alice',
    onboarding_completed_at: '2026-10-30T00:00:00Z',
    bio: '',
    avatar_url: null,
  },
  kind: 'mcp',
  tokenProjectId: 'alice-project',
};
const font = readFile(new URL('../public/fonts/pufu-jp.otf', import.meta.url));
describe('MCP画像の期限付きリンク', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  let image: Awaited<ReturnType<typeof generateQuestionPufuImage>>;
  beforeEach(async () => {
    app = await testApp();
    app.env.ASSETS = { fetch: async () => new Response(await font) } as unknown as Fetcher;
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO questions(id,project_id,text,source,status) VALUES('link-question','alice-project','画像リンクの確認','user','ready')",
      ),
      app.env.DB.prepare(
        "INSERT INTO pufu_scores(id,user_id,question_id,task,input_json,score_json,editor_version,status) VALUES('link-pufu','alice','link-question','課題','{}',?,'0.9.15','ready')",
      ).bind(JSON.stringify(score)),
    ]);
    image = await generateQuestionPufuImage(app.env, principal, 'link-question', 'link-pufu');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app.dispose();
  });
  async function issue() {
    const link = await issuePufuImageLink(app.env, principal, image);
    expect(link.image_url).toBeTruthy();
    return { ...link, path: new URL(link.image_url!).pathname };
  }
  const open = (path: string, method = 'GET') =>
    app.request(path, { method, headers: { Cookie: '', Origin: '' } });
  function replaceContent(method: 'get' | 'put', implementation: unknown) {
    const content = app.env.CONTENT;
    app.env.CONTENT = new Proxy(content, {
      get: (target, key) => (key === method ? implementation : Reflect.get(target, key)),
    });
  }
  const expire = () =>
    app.env.DB.prepare("UPDATE pufu_image_links SET expires_at='2000-01-01T00:00:00.000Z'").run();

  it('認証ヘッダーなしで同じPNGを返し、HEAD・ダウンロードも描画やAIを起動しない', async () => {
    const link = await issue();
    const render = vi.spyOn(renderer, 'renderSavedPufu');
    const run = vi.fn();
    app.env.AI = { run };
    const preview = await open(link.path);
    expect(preview.status).toBe(200);
    expect(preview.headers.get('Content-Type')).toBe('image/png');
    expect(preview.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(preview.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(preview.headers.get('Cache-Control')).toBe('no-store');
    expect(preview.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(preview.headers.get('X-Robots-Tag')).toContain('noindex');
    expect(Buffer.from(await preview.arrayBuffer())).toEqual(Buffer.from(image.png!));
    const head = await open(link.path, 'HEAD');
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(head.headers.get('Content-Length')).toBe(String(image.png!.length));
    const download = await open(link.path + '?download=1');
    expect(download.headers.get('Content-Disposition')).toBe('attachment; filename="pufu.png"');
    expect(render).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(app.env.ARTICLE_WORKFLOW.create).not.toHaveBeenCalled();
    const row = (await app.env.DB.prepare('SELECT * FROM pufu_image_links').first())!;
    expect(row.token_hash).not.toBe(link.path.split('/').at(-1)!.replace('.png', ''));
    expect(JSON.stringify(link)).not.toContain('alice/');
    expect(new Date(link.expires_at!).getTime() - Date.now()).toBeGreaterThan(3500000);
  });
  it('無効・推測したトークンや期限切れはR2を読まず404にし、期限後に画像を削除する', async () => {
    const link = await issue();
    const get = vi.fn(app.env.CONTENT.get.bind(app.env.CONTENT));
    replaceContent('get', get);
    for (const path of ['/api/pufu-images/bad.png', '/api/pufu-images/' + 'A'.repeat(43) + '.png'])
      expect((await open(path)).status).toBe(404);
    await expire();
    expect((await open(link.path)).status).toBe(404);
    expect(get).not.toHaveBeenCalled();
    await cleanupExpiredPufuImageLinks(app.env);
    expect((await app.env.CONTENT.list({ prefix: 'alice/mcp-pufu-images/' })).objects).toHaveLength(
      0,
    );
    expect(await app.env.DB.prepare('SELECT * FROM pufu_image_links').first()).toBeNull();
  });
  it.each(['update', 'phase', 'delete', 'move', 'account'] as const)(
    '%s後のURLは使えない',
    async (operation) => {
      const link = await issue();
      if (operation === 'update')
        await app.env.DB.prepare(
          "UPDATE pufu_scores SET revision=revision+1 WHERE id='link-pufu'",
        ).run();
      else if (operation === 'phase')
        await app.env.DB.prepare(
          "UPDATE pufu_scores SET current_phase=2 WHERE id='link-pufu'",
        ).run();
      else if (operation === 'delete')
        await app.env.DB.prepare("DELETE FROM pufu_scores WHERE id='link-pufu'").run();
      else if (operation === 'move')
        await app.env.DB.prepare(
          "UPDATE questions SET project_id='alice-second' WHERE id='link-question'",
        ).run();
      else expect((await app.request('/api/v1/me', { method: 'DELETE' })).status).toBe(200);
      const get = vi.fn(app.env.CONTENT.get.bind(app.env.CONTENT));
      replaceContent('get', get);
      expect((await open(link.path)).status).toBe(404);
      expect(get).not.toHaveBeenCalled();
      if (operation === 'account')
        expect((await app.env.CONTENT.list({ prefix: 'alice/' })).objects).toHaveLength(0);
    },
  );
  it('保存失敗はBase64へ戻せる案内を返し、pendingを公開しない', async () => {
    replaceContent('put', vi.fn().mockRejectedValueOnce(new Error('SECRET_FAILURE')));
    const result = await issuePufuImageLink(app.env, principal, image);
    expect(result).toMatchObject({ image_url_error: expect.any(String) });
    expect(result.image_url).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('SECRET_');
    expect(await app.env.DB.prepare('SELECT ready FROM pufu_image_links').first()).toEqual({
      ready: 0,
    });
    await expire();
    await cleanupExpiredPufuImageLinks(app.env);
    expect(await app.env.DB.prepare('SELECT * FROM pufu_image_links').first()).toBeNull();
  });
  it.each(['update', 'delete', 'move', 'database'] as const)(
    'R2障害と%sが重なっても古いBase64へフォールバックしない',
    async (operation) => {
      replaceContent(
        'put',
        vi.fn(async () => {
          if (operation === 'update')
            await app.env.DB.prepare(
              "UPDATE pufu_scores SET revision=revision+1 WHERE id='link-pufu'",
            ).run();
          else if (operation === 'delete')
            await app.env.DB.prepare("DELETE FROM pufu_scores WHERE id='link-pufu'").run();
          else if (operation === 'move')
            await app.env.DB.prepare(
              "UPDATE questions SET project_id='alice-second' WHERE id='link-question'",
            ).run();
          else {
            const db = app.env.DB;
            app.env.DB = new Proxy(db, {
              get: (target, key) =>
                key === 'prepare'
                  ? () => {
                      throw new Error('SECRET_DB');
                    }
                  : Reflect.get(target, key),
            });
          }
          throw new Error('SECRET_R2');
        }),
      );
      await expect(issuePufuImageLink(app.env, principal, image)).rejects.toMatchObject({
        status: operation === 'update' ? 409 : operation === 'database' ? 503 : 404,
      });
    },
  );
  it('リンク発行はユーザーあたり50件までとし、並行リクエストでも超えない', async () => {
    const statement = app.env.DB
      .prepare(`INSERT INTO pufu_image_links(token_hash,user_id,question_id,pufu_id,project_id,phase,revision,content_key,expires_at)
      VALUES(?,'alice','link-question','link-pufu','alice-project',1,1,?,'2099-01-01T00:00:00Z')`);
    await app.env.DB.batch(
      Array.from({ length: 49 }, (_, i) => statement.bind('seed-' + i, 'alice/seed-' + i)),
    );
    const results = await Promise.all([
      issuePufuImageLink(app.env, principal, image),
      issuePufuImageLink(app.env, principal, image),
    ]);
    expect(results.filter((result) => result.image_url)).toHaveLength(1);
    expect(results.filter((result) => result.image_url_error)).toHaveLength(1);
    expect(
      await app.env.DB.prepare('SELECT COUNT(*) AS count FROM pufu_image_links').first(),
    ).toEqual({ count: 50 });
    expect((await app.env.CONTENT.list({ prefix: 'alice/mcp-pufu-images/' })).objects).toHaveLength(
      1,
    );
    await app.env.DB.prepare(
      "UPDATE pufu_scores SET revision=revision+1 WHERE id='link-pufu'",
    ).run();
    await expect(issuePufuImageLink(app.env, principal, image)).rejects.toMatchObject({
      status: 409,
    });
    await app.env.DB.prepare("DELETE FROM pufu_scores WHERE id='link-pufu'").run();
    await expect(issuePufuImageLink(app.env, principal, image)).rejects.toMatchObject({
      status: 404,
    });
  });
  it('R2読み取り中に更新された画像は返さず、R2障害は秘密を含まない503にする', async () => {
    const link = await issue();
    const original = app.env.CONTENT.get.bind(app.env.CONTENT);
    let release!: () => void, started!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const begin = new Promise<void>((resolve) => {
      started = resolve;
    });
    replaceContent(
      'get',
      vi.fn(original).mockImplementationOnce(async (...args) => {
        started();
        await wait;
        return original(...args);
      }),
    );
    const request = open(link.path);
    await begin;
    await app.env.DB.prepare(
      "UPDATE pufu_scores SET revision=revision+1 WHERE id='link-pufu'",
    ).run();
    release();
    expect((await request).status).toBe(404);
    await app.env.DB.prepare("UPDATE pufu_scores SET revision=1 WHERE id='link-pufu'").run();
    replaceContent('get', vi.fn().mockRejectedValueOnce(new Error('SECRET_R2KEY')));
    const response = await open(link.path);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('SECRET_');
  });
  it('退会中に遅れて保存したPNGも削除し、リンクを発行しない', async () => {
    const original = app.env.CONTENT.put.bind(app.env.CONTENT);
    let release!: () => void, started!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const begin = new Promise<void>((resolve) => {
      started = resolve;
    });
    replaceContent(
      'put',
      vi.fn(original).mockImplementationOnce(async (...args) => {
        started();
        await wait;
        return original(...args);
      }),
    );
    const publishing = issuePufuImageLink(app.env, principal, image);
    await begin;
    expect((await app.request('/api/v1/me', { method: 'DELETE' })).status).toBe(200);
    release();
    await expect(publishing).rejects.toMatchObject({ status: 409 });
    expect((await app.env.CONTENT.list({ prefix: 'alice/' })).objects).toHaveLength(0);
    expect(await app.env.DB.prepare('SELECT * FROM pufu_image_links').first()).toBeNull();
  });
});
