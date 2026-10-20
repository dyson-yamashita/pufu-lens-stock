import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { testApp } from './helpers';
import { PufuImageError } from '@pufu-lens/pufu-image';
import * as renderer from '../server/pufu-renderer';
import score from './fixtures/pufu-sparse.json';

const font = readFile(new URL('../public/fonts/pufu-jp.otf', import.meta.url));
describe('プ譜画像をリクエスト時に生成する', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  const imagePath = '/api/v1/questions/image-question/pufu/image';
  beforeEach(async () => {
    app = await testApp();
    app.env.ASSETS = { fetch: async () => new Response(await font) } as unknown as Fetcher;
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO questions(id,project_id,source,text,status) VALUES('image-question','alice-project','user','画像を共有する','ready')",
      ),
      app.env.DB.prepare(
        `INSERT INTO pufu_scores(id,user_id,question_id,task,input_json,score_json,editor_version,status)
        VALUES('image-pufu','alice','image-question','task','{}',?,'0.9.15','ready')`,
      ).bind(JSON.stringify(score)),
    ]);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app.dispose();
  });
  const snapshot = () =>
    app.env.DB.batch([
      app.env.DB.prepare('SELECT * FROM pufu_scores'),
      app.env.DB.prepare('SELECT * FROM pufu_phases'),
      app.env.DB.prepare('SELECT * FROM processing_jobs'),
      app.env.DB.prepare('SELECT * FROM ai_calls'),
    ]).then((results) => results.map((result) => result.results));
  it('毎回1回だけ生成し、DB/R2を更新せずAIやWorkflowを起動しない', async () => {
    const render = vi.spyOn(renderer, 'renderSavedPufu');
    const run = vi.fn();
    app.env.AI = { run };
    const before = await snapshot();
    for (let i = 0; i < 2; i++) {
      const response = await app.request(imagePath);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('image/png');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(
        Buffer.from(await response.arrayBuffer())
          .subarray(0, 8)
          .toString('hex'),
      ).toBe('89504e470d0a1a0a');
    }
    expect(render).toHaveBeenCalledTimes(2);
    expect(await snapshot()).toEqual(before);
    expect((await app.env.CONTENT.list({ prefix: 'alice/' })).objects).toEqual([]);
    expect(run).not.toHaveBeenCalled();
    expect(app.env.ARTICLE_WORKFLOW.create).not.toHaveBeenCalled();
  });
  it('保存・局面追加では生成せず、次の画像リクエストに最新の内容を使う', async () => {
    const render = vi.spyOn(renderer, 'renderSavedPufu');
    const updated = structuredClone(score);
    updated.gainingGoal.text = '更新後の目標';
    expect(
      (
        await app.request('/api/v1/pufus/image-pufu', {
          method: 'PATCH',
          body: { revision: 1, score: updated },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request('/api/v1/pufus/image-pufu/phases', {
          method: 'POST',
          body: { revision: 2, phase: 1, score: updated },
        })
      ).status,
    ).toBe(201);
    expect(render).not.toHaveBeenCalled();
    expect((await app.request(imagePath)).status).toBe(200);
    expect(render).toHaveBeenCalledExactlyOnceWith(app.env, updated);
  });
  it('権限不足・存在しない問いでは描画しない', async () => {
    const render = vi.spyOn(renderer, 'renderSavedPufu');
    expect((await app.request(imagePath, { user: 'bob' })).status).toBe(404);
    expect((await app.request('/api/v1/questions/missing/pufu/image')).status).toBe(404);
    expect((await app.request(imagePath, { user: 'missing' })).status).toBe(401);
    expect(render).not.toHaveBeenCalled();
  });
  it('未作成は明示し、画像を生成しない', async () => {
    const render = vi.spyOn(renderer, 'renderSavedPufu');
    await app.env.DB.prepare("DELETE FROM pufu_scores WHERE id='image-pufu'").run();
    const response = await app.request(imagePath);
    expect(await response.json()).toMatchObject({
      status: 'not_created',
      phase: null,
      revision: null,
    });
    expect(render).not.toHaveBeenCalled();
  });
  it('過大な画像は413を返し、保存済みプ譜を変更しない', async () => {
    const huge = structuredClone(score);
    huge.elements.people.text = '\n'.repeat(1000);
    await app.env.DB.prepare('UPDATE pufu_scores SET score_json=? WHERE id=?')
      .bind(JSON.stringify(huge), 'image-pufu')
      .run();
    const before = await snapshot();
    expect((await app.request(imagePath)).status).toBe(413);
    expect(await snapshot()).toEqual(before);
    expect((await app.request('/api/v1/questions/image-question/pufu')).status).toBe(200);
  });
  it.each(['WASM_UNAVAILABLE', 'FONT_UNAVAILABLE'])(
    '%sは503を返し、次のリクエストで再生成できる',
    async (code) => {
      vi.spyOn(renderer, 'renderSavedPufu').mockRejectedValueOnce(
        new PufuImageError(code, 'temporary'),
      );
      const before = await snapshot();
      expect((await app.request(imagePath)).status).toBe(503);
      expect((await app.request(imagePath)).status).toBe(200);
      expect(await snapshot()).toEqual(before);
    },
  );
  it('フォント通信の例外を制御されたエラーにし、再取得で回復する', async () => {
    const modulePath = '../server/pufu-renderer.ts?font-failure';
    const fresh = (await import(modulePath)) as typeof renderer;
    const unavailable = {
      ...app.env,
      ASSETS: {
        fetch: async () => {
          throw new Error('network unavailable');
        },
      } as unknown as Fetcher,
    };
    await expect(fresh.renderSavedPufu(unavailable, score)).rejects.toMatchObject({
      code: 'FONT_UNAVAILABLE',
    });
    await expect(fresh.renderSavedPufu(app.env, score)).resolves.toMatchObject({ width: 1760 });
  });
  it.each(['update', 'delete'] as const)('描画中の%s後は古い画像を返さない', async (operation) => {
    const original = renderer.renderSavedPufu;
    let release!: () => void, started!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const begin = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(renderer, 'renderSavedPufu').mockImplementationOnce(async (env, score) => {
      started();
      await wait;
      return original(env, score);
    });
    const request = app.request(imagePath);
    await begin;
    if (operation === 'delete')
      await app.env.DB.prepare("DELETE FROM questions WHERE id='image-question'").run();
    else
      await app.env.DB.prepare(
        "UPDATE pufu_scores SET revision=revision+1 WHERE id='image-pufu'",
      ).run();
    release();
    expect((await request).status).toBe(operation === 'delete' ? 404 : 409);
  });
  it('JSONの破損を未作成として扱わない', async () => {
    const render = vi.spyOn(renderer, 'renderSavedPufu');
    await app.env.DB.prepare(
      "UPDATE pufu_scores SET score_json='broken' WHERE id='image-pufu'",
    ).run();
    expect((await app.request(imagePath)).status).toBe(500);
    expect(render).not.toHaveBeenCalled();
  });
});
