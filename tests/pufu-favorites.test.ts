import { afterEach, beforeEach, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { createApp } from '../server/api';
import type { Pufu, PufuListItem } from '../shared/pufu';
import type { User } from '../shared/domain';
import { applyMigration, testApp } from './helpers';

let app: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  app = await testApp();
});
afterEach(async () => app.dispose());
function fixture(id: string, options: { user?: string; project?: string; status?: string } = {}) {
  const user = options.user ?? 'alice';
  return app.env.DB.prepare(
    `INSERT INTO pufu_scores(id,user_id,project_id,task,input_json,editor_version,status,created_at)
    VALUES (?,?,?,?,'{}','0.9.19',?,'2026-10-27T00:00:00Z')`,
  ).bind(id, user, options.project ?? `${user}-project`, id, options.status ?? 'queued');
}
const favorite = (id: string, value: boolean, options = {}) =>
  app.request(`/api/v1/pufus/${id}/favorite`, {
    method: 'PATCH',
    body: { is_favorite: value },
    ...options,
  });
async function list(query = '') {
  const response = await app.request(`/api/v1/pufus${query}`);
  expect(response.status).toBe(200);
  return (await response.json()) as { pufus: PufuListItem[]; total: number };
}

it('生成状態を問わず登録・解除でき、再取得でも保持し本文や更新番号を変えない', async () => {
  await app.env.DB.batch(
    ['queued', 'generating', 'ready', 'failed'].map((status) => fixture(status, { status })),
  );
  expect((await list()).pufus.every((pufu) => pufu.is_favorite === 0)).toBe(true);
  for (const id of ['queued', 'generating', 'ready', 'failed']) {
    const before = await app.env.DB.prepare('SELECT * FROM pufu_scores WHERE id=?')
      .bind(id)
      .first();
    expect(await (await favorite(id, true)).json()).toEqual({ id, is_favorite: 1 });
    expect((await favorite(id, true)).status).toBe(200);
    expect(
      await app.env.DB.prepare('SELECT * FROM pufu_scores WHERE id=?').bind(id).first(),
    ).toEqual({ ...before, is_favorite: 1 });
    const detail = (await (await app.request(`/api/v1/pufus/${id}`)).json()) as { pufu: Pufu };
    expect(detail.pufu.is_favorite).toBe(1);
  }
  expect((await list('?favorite=true')).total).toBe(4);
  expect(await (await favorite('queued', false)).json()).toEqual({ id: 'queued', is_favorite: 0 });
  expect((await list('?favorite=true')).total).toBe(3);
  expect((await list('?favorite=false')).total).toBe(4);
});

it('お気に入りだけのページと件数を一致させ、非表示プロジェクトと他人のプ譜を除外する', async () => {
  await app.env.DB.batch([
    ...Array.from({ length: 26 }, (_, i) => fixture(`fav-${String(i).padStart(2, '0')}`)),
    fixture('normal'),
    fixture('hidden', { project: 'alice-second' }),
    fixture('foreign', { user: 'bob' }),
    app.env.DB.prepare("UPDATE projects SET show_in_all_lists=0 WHERE id='alice-second'"),
  ]);
  await app.env.DB.prepare("UPDATE pufu_scores SET is_favorite=1 WHERE id<>'normal'").run();
  const first = await list('?favorite=true');
  const second = await list('?favorite=true&page=2');
  expect([first.total, second.total, first.pufus.length, second.pufus.length]).toEqual([
    26, 26, 24, 2,
  ]);
  expect(new Set([...first.pufus, ...second.pufus].map((pufu) => pufu.id)).size).toBe(26);
  expect(
    [...first.pufus, ...second.pufus].every(
      (pufu) => pufu.is_favorite === 1 && pufu.id.startsWith('fav-'),
    ),
  ).toBe(true);
  expect(
    (await list('?favorite=true&project_id=alice-second')).pufus.map((pufu) => pufu.id),
  ).toEqual(['hidden']);
  expect((await app.request('/api/v1/pufus?favorite=true&project_id=bob-project')).status).toBe(
    404,
  );
});

it('他人・未認証・別サイト・トークン・MCPの更新と不正な値を拒否する', async () => {
  await app.env.DB.batch([fixture('owned')]);
  expect((await favorite('owned', true, { user: 'bob' })).status).toBe(404);
  expect((await favorite('missing', true)).status).toBe(404);
  expect((await favorite('owned', true, { headers: { Cookie: '' } })).status).toBe(401);
  expect(
    (await favorite('owned', true, { headers: { Origin: 'https://evil.example.com' } })).status,
  ).toBe(403);
  const { token } = (await (
    await app.request('/api/v1/tokens', { method: 'POST', body: { name: '保存用' } })
  ).json()) as { token: string };
  expect(
    (await favorite('owned', true, { headers: { Authorization: `Bearer ${token}` } })).status,
  ).toBe(403);
  const user = await app.env.DB.prepare(
    "SELECT id,name,bio,onboarding_completed_at,avatar_url FROM users WHERE id='alice'",
  ).first<User>();
  const mcp = createApp({ kind: 'mcp', user: user!, tokenProjectId: null });
  expect(
    (
      await mcp.request(
        `${app.env.APP_URL}/api/v1/pufus/owned/favorite`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Origin: app.env.APP_URL },
          body: JSON.stringify({ is_favorite: true }),
        },
        app.env,
        app.ctx,
      )
    ).status,
  ).toBe(403);
  for (const body of [
    {},
    { is_favorite: 1 },
    { is_favorite: 'true' },
    { is_favorite: true, task: '変更' },
  ]) {
    expect(
      (await app.request('/api/v1/pufus/owned/favorite', { method: 'PATCH', body })).status,
    ).toBe(400);
  }
  expect((await app.request('/api/v1/pufus?favorite=invalid')).status).toBe(400);
  expect((await list()).pufus[0].is_favorite).toBe(0);
});

it('移行で既存のプ譜を保全し、お気に入りを未選択にする', async () => {
  await app.dispose();
  const migrations = (await readdir(new URL('../migrations/', import.meta.url)))
    .filter((name) => name.endsWith('.sql') && name < '0031')
    .sort();
  app = await testApp({ migrations });
  await app.env.DB.batch([fixture('existing')]);
  const before = await app.env.DB.prepare('SELECT * FROM pufu_scores').all();
  await applyMigration(app.env.DB, '0031_pufu_favorites.sql');
  expect((await app.env.DB.prepare('SELECT * FROM pufu_scores').all()).results).toEqual(
    before.results.map((pufu) => ({ ...pufu, is_favorite: 0 })),
  );
  await expect(app.env.DB.prepare('UPDATE pufu_scores SET is_favorite=2').run()).rejects.toThrow();
  expect((await favorite('existing', true)).status).toBe(200);
});
