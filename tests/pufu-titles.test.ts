import { afterEach, beforeEach, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { createApp } from '../server/api';
import type { User } from '../shared/domain';
import { pufuDisplayTitle, type Pufu } from '../shared/pufu';
import { applyMigration, testApp } from './helpers';
import score from './fixtures/pufu-sparse.json';

let app: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  app = await testApp();
});
afterEach(async () => app.dispose());
const create = async (data = {}) =>
  app.request('/api/v1/pufus', {
    method: 'POST',
    body: { project_id: 'alice-project', score, request_id: crypto.randomUUID(), ...data },
  });
const rename = (id: string, title: unknown, options = {}) =>
  app.request(`/api/v1/pufus/${id}/title`, { method: 'PATCH', body: { title }, ...options });
async function detail(id: string) {
  const response = await app.request(`/api/v1/pufus/${id}`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { pufu: Pufu }).pufu;
}

it('任意タイトルを保存・変更・解除でき、本文・局面・編集番号を保つ', async () => {
  const request_id = crypto.randomUUID();
  const response = await create({ title: '  短いタイトル  ', request_id });
  expect(response.status).toBe(201);
  const { pufu } = (await response.json()) as { pufu: { id: string } };
  const before = await detail(pufu.id);
  expect(before.title).toBe('短いタイトル');
  expect(await (await rename(pufu.id, '  編集タイトル  ')).json()).toEqual({
    id: pufu.id,
    title: '編集タイトル',
  });
  expect(await detail(pufu.id)).toEqual({ ...before, title: '編集タイトル' });
  expect((await create({ title: '短いタイトル', request_id })).status).toBe(200);
  expect((await create({ title: '別タイトル', request_id })).status).toBe(409);
  expect(await (await app.request('/api/v1/pufus')).json()).toMatchObject({
    pufus: [{ title: '編集タイトル' }],
  });
  expect((await rename(pufu.id, ' \n\t ')).status).toBe(200);
  expect(pufuDisplayTitle(await detail(pufu.id))).toBe(score.gainingGoal.text);
});

it('自動生成の依頼でもタイトルは任意で、変更後の同一依頼の再送を受け付ける', async () => {
  const request_id = crypto.randomUUID();
  const generate = (data = {}) =>
    app.request('/api/v1/projects/alice-project/pufus/generate', {
      method: 'POST',
      body: { task: '実現したい状態', request_id, title: '実行計画', ...data },
    });
  const response = await generate();
  expect(response.status).toBe(202);
  const { id } = (await response.json()) as { id: string };
  expect((await detail(id)).title).toBe('実行計画');
  await rename(id, '変更後');
  expect((await generate()).status).toBe(200);
  expect((await generate({ title: '異なる依頼' })).status).toBe(409);
  const untitled = await generate({ request_id: crypto.randomUUID(), title: '' });
  expect(untitled.status).toBe(202);
  expect((await detail(((await untitled.json()) as { id: string }).id)).title).toBeNull();
});

it('未設定時は最新局面ではなく第1局面の獲得目標を一覧・詳細で表示する', async () => {
  const { pufu } = (await (await create()).json()) as { pufu: { id: string } };
  const nextScore = structuredClone(score);
  nextScore.gainingGoal.text = '第2局面の新しい目標';
  expect(
    (
      await app.request(`/api/v1/pufus/${pufu.id}/phases`, {
        method: 'POST',
        body: { revision: 1, phase: 1, score },
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await app.request(`/api/v1/pufus/${pufu.id}`, {
        method: 'PATCH',
        body: { revision: 2, phase: 2, score: nextScore },
      })
    ).status,
  ).toBe(200);
  const saved = await detail(pufu.id);
  expect(saved.task).toBe(nextScore.gainingGoal.text);
  expect(pufuDisplayTitle(saved)).toBe(score.gainingGoal.text);
  const list = (await (await app.request('/api/v1/pufus')).json()) as { pufus: Pufu[] };
  expect(pufuDisplayTitle(list.pufus[0])).toBe(score.gainingGoal.text);
  await rename(pufu.id, '見出し');
  expect(pufuDisplayTitle(await detail(pufu.id))).toBe('見出し');
  await rename(pufu.id, '');
  expect(pufuDisplayTitle(await detail(pufu.id))).toBe(score.gainingGoal.text);
});

it('タイトルの型・長さを検証し、他人・未認証・CSRF・保存用トークン・MCPからの編集を拒否する', async () => {
  const { pufu } = (await (await create()).json()) as { pufu: { id: string } };
  for (const title of [null, 123, 'あ'.repeat(201)])
    expect((await rename(pufu.id, title)).status).toBe(400);
  expect((await rename(pufu.id, '変更', { body: { title: '変更', task: '上書き' } })).status).toBe(
    400,
  );
  expect((await rename(pufu.id, 'あ'.repeat(200))).status).toBe(200);
  expect((await rename(pufu.id, '他人', { user: 'bob' })).status).toBe(404);
  expect((await rename('missing', '存在しない')).status).toBe(404);
  expect((await rename(pufu.id, '未認証', { headers: { Cookie: '' } })).status).toBe(401);
  expect(
    (await rename(pufu.id, 'CSRF', { headers: { Origin: 'https://evil.example.com' } })).status,
  ).toBe(403);
  const { token } = (await (
    await app.request('/api/v1/tokens', { method: 'POST', body: { name: '保存用' } })
  ).json()) as { token: string };
  expect(
    (await rename(pufu.id, '保存用', { headers: { Authorization: `Bearer ${token}` } })).status,
  ).toBe(403);
  const user = await app.env.DB.prepare(
    "SELECT id,name,bio,onboarding_completed_at,avatar_url FROM users WHERE id='alice'",
  ).first<User>();
  const mcp = createApp({ kind: 'mcp', user: user!, tokenProjectId: null });
  expect(
    (
      await mcp.request(
        `${app.env.APP_URL}/api/v1/pufus/${pufu.id}/title`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'MCP' }),
        },
        app.env,
        app.ctx,
      )
    ).status,
  ).toBe(403);
  expect((await detail(pufu.id)).title).toBe('あ'.repeat(200));
});

it('移行後も既存の本文・局面を保ち、タイトル未設定で利用できる', async () => {
  await app.dispose();
  const migrations = (await readdir(new URL('../migrations/', import.meta.url)))
    .filter((name) => name.endsWith('.sql') && name < '0039')
    .sort();
  app = await testApp({ migrations });
  await app.env.DB.prepare(
    "INSERT INTO pufu_scores(id,user_id,project_id,task,input_json,editor_version) VALUES ('old','alice','alice-project','旧目標','{}','0.9.19')",
  ).run();
  const before = await app.env.DB.prepare("SELECT * FROM pufu_scores WHERE id='old'").first();
  await applyMigration(app.env.DB, '0039_pufu_titles.sql');
  expect(await app.env.DB.prepare("SELECT * FROM pufu_scores WHERE id='old'").first()).toEqual({
    ...before,
    title: null,
  });
  expect(pufuDisplayTitle(await detail('old'))).toBe('旧目標');
});
