import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { testApp, applyMigration } from './helpers';
import { PufuImageError } from '@pufu-lens/pufu-image';
import * as renderer from '../server/pufu-renderer';
import { syncPufuImages } from '../server/pufu-images';
import score from './fixtures/pufu-sparse.json';
import type { Env } from '../server/env';

const font = readFile(new URL('../public/fonts/pufu-jp.otf', import.meta.url));
describe('プ譜画像の非同期保存と回収', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
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
  const metadata = () =>
    app.request('/api/v1/questions/image-question/pufu/image').then((r) => r.json()) as Promise<
      Record<string, unknown>
    >;
  const entries = () =>
    app.env.DB.prepare('SELECT * FROM pufu_image_entries ORDER BY current,id')
      .all<Record<string, unknown>>()
      .then((r) => r.results);
  it('生成前のreadは処理を起動せず、生成後はPNGを取得できる', async () => {
    const before = await entries();
    expect(await metadata()).toMatchObject({ status: 'pending' });
    expect(await entries()).toEqual(before);
    await syncPufuImages(app.env);
    expect(await metadata()).toMatchObject({
      status: 'ready',
      mime_type: 'image/png',
      revision: 1,
      phase: 1,
    });
    const response = await app.request('/api/v1/questions/image-question/pufu/image/content');
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(
      Buffer.from(await response.arrayBuffer())
        .subarray(0, 8)
        .toString('hex'),
    ).toBe('89504e470d0a1a0a');
    expect(
      (await app.request('/api/v1/questions/image-question/pufu/image', { user: 'bob' })).status,
    ).toBe(404);
  });
  it('保存と局面追加で更新し、古い画像のIf-Matchを拒否する', async () => {
    await syncPufuImages(app.env);
    const old = await metadata();
    const updated = structuredClone(score);
    updated.gainingGoal.text = '更新した目標';
    const saved = await app.request('/api/v1/pufus/image-pufu', {
      method: 'PATCH',
      body: { revision: 1, score: updated },
    });
    expect(saved.status).toBe(200);
    expect(await metadata()).toMatchObject({ status: 'ready', revision: 2, phase: 1 });
    expect(
      (
        await app.request('/api/v1/questions/image-question/pufu/image/content', {
          headers: { 'If-Match': `"${old.image_id}"` },
        })
      ).status,
    ).toBe(412);
    expect(
      (
        await app.request('/api/v1/pufus/image-pufu/phases', {
          method: 'POST',
          body: { revision: 2, phase: 1, score: updated },
        })
      ).status,
    ).toBe(201);
    expect(await metadata()).toMatchObject({ status: 'ready', revision: 3, phase: 2 });
  });
  it.each(['questions', 'projects', 'users'])('%s削除後もR2の削除要求を保持する', async (table) => {
    await syncPufuImages(app.env);
    const entry = (await entries())[0];
    const objectKey = `alice/pufu-images/${entry.id}.png`;
    expect(await app.env.CONTENT.head(objectKey)).not.toBeNull();
    const id =
      table === 'questions' ? 'image-question' : table === 'projects' ? 'alice-project' : 'alice';
    await app.env.DB.prepare(`DELETE FROM ${table} WHERE id=?`).bind(id).run();
    expect((await entries())[0].current).toBe(0);
    await syncPufuImages(app.env);
    expect(await app.env.CONTENT.head(objectKey)).toBeNull();
    expect(await entries()).toEqual([]);
  });
  it('削除後に遅延putが完了しても、次回の削除対象を失わない', async () => {
    const bucket = app.env.CONTENT;
    let release!: () => void, started!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const beginning = new Promise<void>((resolve) => {
      started = resolve;
    });
    app.env.CONTENT = new Proxy(bucket, {
      get(target, property) {
        if (property === 'put')
          return async (...args: Parameters<R2Bucket['put']>) => {
            started();
            await blocked;
            return bucket.put(...args);
          };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as Env['CONTENT'];
    const rendering = syncPufuImages(app.env);
    await beginning;
    const entry = (await entries())[0];
    await app.env.DB.prepare("DELETE FROM questions WHERE id='image-question'").run();
    await app.env.DB.prepare('UPDATE pufu_image_entries SET lease_until=NULL').run();
    await syncPufuImages(app.env);
    expect((await entries())[0].write_pending).toBe(1);
    release();
    await rendering;
    expect((await entries())[0].write_pending).toBe(0);
    await syncPufuImages(app.env);
    expect(await entries()).toEqual([]);
    expect(await bucket.head(`alice/pufu-images/${entry.id}.png`)).toBeNull();
  });
  it('期限切れの未確定書き込みは別キーで回復する', async () => {
    const old = (await entries())[0];
    await app.env.DB.prepare(
      "UPDATE pufu_image_entries SET touched=1,write_pending=1,lease_until='2000-01-01',attempts=1",
    ).run();
    await syncPufuImages(app.env);
    const current = (await entries()).find((e) => e.current === 1)!;
    expect(current.id).not.toBe(old.id);
    await syncPufuImages(app.env);
    expect(await metadata()).toMatchObject({ status: 'ready' });
    expect((await entries()).find((e) => e.id === old.id)).toMatchObject({
      current: 0,
      write_pending: 1,
    });
  });
  it('巨大な画像の失敗をプ譜本体の失敗と混同しない', async () => {
    const huge = structuredClone(score);
    huge.elements.people.text = '\n'.repeat(1000);
    await app.env.DB.prepare('UPDATE pufu_scores SET score_json=? WHERE id=?')
      .bind(JSON.stringify(huge), 'image-pufu')
      .run();
    const run = vi.fn();
    app.env.AI = { run };
    await syncPufuImages(app.env);
    expect(await metadata()).toMatchObject({ status: 'failed', error: 'IMAGE_TOO_LARGE' });
    expect(
      await app.env.DB.prepare("SELECT status FROM pufu_scores WHERE id='image-pufu'").first(),
    ).toMatchObject({ status: 'ready' });
    expect(run).not.toHaveBeenCalled();
    expect(await app.env.CONTENT.list({ prefix: 'alice/pufu-images/' })).toMatchObject({
      objects: [],
    });
  });
  it('R2欠落や破損を未作成として返さない', async () => {
    await syncPufuImages(app.env);
    const entry = (await entries())[0];
    await app.env.CONTENT.put(`alice/pufu-images/${entry.id}.png`, 'broken');
    expect((await app.request('/api/v1/questions/image-question/pufu/image/content')).status).toBe(
      500,
    );
    await app.env.CONTENT.delete(`alice/pufu-images/${entry.id}.png`);
    expect((await app.request('/api/v1/questions/image-question/pufu/image/content')).status).toBe(
      500,
    );
  });
  it('WASM初期化の一時障害は再試行し、プ譜本体を維持する', async () => {
    vi.spyOn(renderer, 'renderSavedPufu').mockRejectedValueOnce(
      new PufuImageError('WASM_UNAVAILABLE', 'temporary'),
    );
    await syncPufuImages(app.env);
    expect((await entries())[0]).toMatchObject({
      failed: 0,
      attempts: 1,
      error: 'WASM_UNAVAILABLE',
    });
    await app.env.DB.prepare("UPDATE pufu_image_entries SET next_attempt_at='2000-01-01'").run();
    await syncPufuImages(app.env);
    expect(await metadata()).toMatchObject({ status: 'ready' });
    expect((await entries())[0]).toMatchObject({ attempts: 2 });
  });
  it('既存の完成済みプ譜を移行し、最新局面の画像を準備する', async () => {
    const migrations = (await readdir(new URL('../migrations/', import.meta.url)))
      .filter((name) => name.endsWith('.sql') && name !== '0024_pufu_images.sql')
      .sort();
    const legacy = await testApp({ migrations });
    try {
      await legacy.env.DB.batch([
        legacy.env.DB.prepare(
          "INSERT INTO questions(id,project_id,source,text,status) VALUES('legacy-image-question','alice-project','user','移行の確認','ready')",
        ),
        legacy.env.DB.prepare(
          `INSERT INTO pufu_scores(id,user_id,question_id,task,input_json,score_json,editor_version,status,current_phase)
          VALUES('legacy-image-pufu','alice','legacy-image-question','task','{}',?,'0.9.15','ready',2)`,
        ).bind(JSON.stringify(score)),
        legacy.env.DB.prepare(
          "INSERT INTO pufu_phases(pufu_id,number,score_json,created_at,updated_at) VALUES('legacy-image-pufu',2,?,'2026-10-20','2026-10-20')",
        ).bind(JSON.stringify(score)),
      ]);
      await applyMigration(legacy.env.DB, '0024_pufu_images.sql');
      expect(
        await legacy.env.DB.prepare('SELECT phase,current FROM pufu_image_entries').first(),
      ).toMatchObject({ phase: 2, current: 1 });
      legacy.env.ASSETS = app.env.ASSETS;
      await syncPufuImages(legacy.env);
      const response = await legacy.request('/api/v1/questions/legacy-image-question/pufu/image');
      expect(await response.json()).toMatchObject({ status: 'ready', phase: 2 });
    } finally {
      await legacy.dispose();
    }
  });
});
