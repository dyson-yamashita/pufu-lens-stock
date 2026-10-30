import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { testApp } from './helpers';
import { PufuImageError } from '@pufu-lens/pufu-image';
import * as renderer from '../server/pufu-renderer';
import score from './fixtures/pufu-sparse.json';

const font = readFile(new URL('../public/fonts/pufu-jp.otf', import.meta.url));
describe('プ譜画像をリクエスト時に生成する', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  const pufuPath = '/api/v1/questions/image-question/pufu/image-pufu';
  const imagePath = `${pufuPath}/image`;
  const legacyImagePath = '/api/v1/questions/image-question/pufu/image';
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
  it('複数のプ譜から指定したIDのJSON・画像を取得し、互換URLは最新を返す', async () => {
    const newer = structuredClone(score);
    newer.gainingGoal.text = '新しく作成した別のプ譜';
    await app.env.DB.prepare(
      `INSERT INTO pufu_scores(id,user_id,question_id,task,input_json,score_json,editor_version,status,created_at)
        VALUES('newer-pufu','alice','image-question','newer','{}',?,'0.9.15','ready','2030-01-01')`,
    )
      .bind(JSON.stringify(newer))
      .run();
    const before = await snapshot();
    const render = vi.spyOn(renderer, 'renderSavedPufu');
    for (const [id, saved] of [
      ['image-pufu', score],
      ['newer-pufu', newer],
    ] as const) {
      const path = `/api/v1/questions/image-question/pufu/${id}`;
      const response = await app.request(path);
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toMatchObject({
        question_id: 'image-question',
        pufu_id: id,
        project_id: 'alice-project',
        projectScore: saved,
      });
      expect((await app.request(`${path}/image`)).status).toBe(200);
      expect(render).toHaveBeenLastCalledWith(app.env, saved, 'ja');
    }
    expect(await (await app.request('/api/v1/questions/image-question/pufu')).json()).toMatchObject(
      { projectScore: newer },
    );
    expect((await app.request(legacyImagePath)).status).toBe(200);
    expect(render).toHaveBeenCalledTimes(3);
    expect(render).toHaveBeenLastCalledWith(app.env, newer, 'ja');
    expect(await snapshot()).toEqual(before);
  });
  it('別の問い・別ユーザーのプ譜や存在しないIDは404にして描画しない', async () => {
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO questions(id,project_id,text,source,status) VALUES('other-question','alice-project','別の問い','user','ready'),('bob-question','bob-project','Bobの問い','user','ready')",
      ),
      app.env.DB.prepare(
        `INSERT INTO pufu_scores(id,user_id,question_id,task,input_json,score_json,editor_version,status) VALUES
          ('other-pufu','alice','other-question','other','{}',?,'0.9.15','ready'),
          ('bob-pufu','bob','bob-question','bob','{}',?,'0.9.15','ready')`,
      ).bind(JSON.stringify(score), JSON.stringify(score)),
    ]);
    const render = vi.spyOn(renderer, 'renderSavedPufu');
    for (const id of ['other-pufu', 'bob-pufu', 'missing'])
      for (const suffix of ['', '/image'])
        expect(
          (await app.request(`/api/v1/questions/image-question/pufu/${id}${suffix}`)).status,
        ).toBe(404);
    expect((await app.request(pufuPath, { user: 'bob' })).status).toBe(404);
    expect((await app.request(pufuPath, { user: 'missing' })).status).toBe(401);
    expect(render).not.toHaveBeenCalled();
  });
  it.each(['queued', 'generating', 'failed'])(
    '作成未完了のID指定は409を返す: %s',
    async (status) => {
      await app.env.DB.prepare("UPDATE pufu_scores SET status=? WHERE id='image-pufu'")
        .bind(status)
        .run();
      const render = vi.spyOn(renderer, 'renderSavedPufu');
      const before = await snapshot();
      expect((await app.request(pufuPath)).status).toBe(409);
      expect((await app.request(imagePath)).status).toBe(409);
      expect(render).not.toHaveBeenCalled();
      expect(await snapshot()).toEqual(before);
    },
  );
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
    expect(render).toHaveBeenCalledExactlyOnceWith(app.env, updated, 'ja');
  });
  it('権限不足・存在しない問いでは描画しない', async () => {
    const render = vi.spyOn(renderer, 'renderSavedPufu');
    expect((await app.request(imagePath, { user: 'bob' })).status).toBe(404);
    expect((await app.request('/api/v1/questions/missing/pufu/image-pufu/image')).status).toBe(404);
    expect((await app.request(imagePath, { user: 'missing' })).status).toBe(401);
    expect(render).not.toHaveBeenCalled();
  });
  it('未作成は明示し、画像を生成しない', async () => {
    const render = vi.spyOn(renderer, 'renderSavedPufu');
    await app.env.DB.prepare("DELETE FROM pufu_scores WHERE id='image-pufu'").run();
    const response = await app.request(legacyImagePath);
    expect(await response.json()).toMatchObject({
      status: 'not_created',
      phase: null,
      revision: null,
    });
    expect(render).not.toHaveBeenCalled();
    expect((await app.request(imagePath)).status).toBe(404);
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
  it.each(['update', 'delete', 'delete_pufu', 'move', 'newer'] as const)(
    '描画中の%s後も指定したプ譜だけを再確認する',
    async (operation) => {
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
      else if (operation === 'delete_pufu')
        await app.env.DB.prepare("DELETE FROM pufu_scores WHERE id='image-pufu'").run();
      else if (operation === 'move') {
        await app.env.DB.batch([
          app.env.DB.prepare(
            "INSERT INTO questions(id,project_id,text,source,status) VALUES('moved-question','alice-project','移動先','user','ready')",
          ),
          app.env.DB.prepare(
            "UPDATE pufu_scores SET question_id='moved-question' WHERE id='image-pufu'",
          ),
        ]);
      } else if (operation === 'newer')
        await app.env.DB.prepare(
          `INSERT INTO pufu_scores(id,user_id,question_id,task,input_json,score_json,editor_version,status,created_at)
        VALUES('another-pufu','alice','image-question','another','{}',?,'0.9.15','ready','2030-01-01')`,
        )
          .bind(JSON.stringify(score))
          .run();
      else
        await app.env.DB.prepare(
          "UPDATE pufu_scores SET revision=revision+1 WHERE id='image-pufu'",
        ).run();
      release();
      expect((await request).status).toBe(
        operation === 'newer' ? 200 : operation === 'update' ? 409 : 404,
      );
    },
  );
  it('JSONの破損を未作成として扱わない', async () => {
    const render = vi.spyOn(renderer, 'renderSavedPufu');
    await app.env.DB.prepare(
      "UPDATE pufu_scores SET score_json='broken' WHERE id='image-pufu'",
    ).run();
    expect((await app.request(imagePath)).status).toBe(500);
    expect((await app.request(pufuPath)).status).toBe(500);
    expect(render).not.toHaveBeenCalled();
  });
});
