import { afterEach, beforeEach, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { testApp, applyMigration } from './helpers';
import score from './fixtures/pufu-sparse.json';

let app: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  app = await testApp();
});
afterEach(async () => app.dispose());
const create = (data = {}) =>
  app.request('/api/v1/pufus', {
    method: 'POST',
    body: { project_id: 'alice-project', score, request_id: crypto.randomUUID(), ...data },
  });
const edit = (id: string, data = {}) =>
  app.request(`/api/v1/pufus/${id}`, {
    method: 'PATCH',
    body: { score, revision: 1, ...data },
  });

it('問いなしで作成し、再送で重複せず、一覧・詳細・コメント・局面編集を利用できる', async () => {
  const request_id = crypto.randomUUID();
  const response = await create({ request_id });
  expect(response.status).toBe(201);
  const { pufu } = (await response.json()) as { pufu: { id: string } };
  expect((await create({ request_id })).status).toBe(200);
  expect(await (await app.request('/api/v1/pufus')).json()).toMatchObject({
    total: 1,
    pufus: [{ id: pufu.id, project_id: 'alice-project', question_id: null, question_text: null }],
  });
  expect(await (await app.request(`/api/v1/pufus/${pufu.id}`)).json()).toMatchObject({
    pufu: { score, context: { question: null }, phases: [{ number: 1, score }] },
  });
  expect(
    (
      await app.request('/api/v1/comments', {
        method: 'POST',
        body: {
          target_type: 'pufu',
          target_id: pufu.id,
          phase: 1,
          body: '独立した案の記録',
          request_id: crypto.randomUUID(),
        },
      })
    ).status,
  ).toBe(201);
  const changed = structuredClone(score);
  changed.gainingGoal.text = '編集した目標';
  expect((await edit(pufu.id, { score: changed })).status).toBe(200);
  expect((await edit(pufu.id)).status).toBe(409);
  // 初回作成の再送は、その後に編集されても同じプ譜を返す。
  expect((await create({ request_id })).status).toBe(200);
  expect((await create({ request_id, score: changed })).status).toBe(409);
});

it('同じプロジェクトの問いへ紐付け・解除でき、所有権・保存先・問いの不一致を拒否する', async () => {
  await app.env.DB.prepare(
    `INSERT INTO questions(id,project_id,source,text,status) VALUES ('link','alice-project','user','関連する問い','ready'),('elsewhere','alice-second','user','別の問い','ready')`,
  ).run();
  const response = await create({ question_id: 'link' });
  expect(response.status).toBe(201);
  const { pufu } = (await response.json()) as { pufu: { id: string } };
  expect((await edit(pufu.id, { question_id: null })).status).toBe(200);
  await app.request('/api/v1/questions/link', { method: 'DELETE' });
  expect((await app.request(`/api/v1/pufus/${pufu.id}`)).status).toBe(200);
  expect((await edit(pufu.id, { revision: 2, question_id: 'elsewhere' })).status).toBe(404);
  for (const data of [
    { project_id: 'bob-project' },
    { project_id: 'missing' },
    { question_id: 'missing' },
    { question_id: 'elsewhere' },
  ])
    expect((await create(data)).status).toBe(404);
  expect((await create({ score: {} })).status).toBe(400);
  expect(
    (
      await app.request('/api/v1/pufus', {
        method: 'POST',
        headers: { Cookie: '' },
        body: { project_id: 'alice-project', score, request_id: crypto.randomUUID() },
      })
    ).status,
  ).toBe(401);
});

it('既存のプ譜・局面・コメント・画像リンクを移行で保全し、問いの移動に保存先が追随する', async () => {
  await app.dispose();
  const migrations = (await readdir(new URL('../migrations/', import.meta.url)))
    .filter((name) => name.endsWith('.sql') && name < '0029')
    .sort();
  app = await testApp({ migrations });
  await app.env.DB.batch([
    app.env.DB.prepare(
      `INSERT INTO questions(id,project_id,source,text,status) VALUES ('old-question','alice-project','user','移行前の問い','ready')`,
    ),
    app.env.DB.prepare(
      `INSERT INTO pufu_scores(id,user_id,question_id,task,input_json,score_json,editor_version,status) VALUES ('old-pufu','alice','old-question','旧目標','{}',?,'0.9.19','ready')`,
    ).bind(JSON.stringify(score)),
    app.env.DB.prepare(
      `INSERT INTO pufu_phases(pufu_id,number,score_json,created_at,updated_at) VALUES ('old-pufu',1,?,'2026-10-20','2026-10-20')`,
    ).bind(JSON.stringify(score)),
    app.env.DB.prepare(
      `INSERT INTO comments(id,target_type,target_id,phase,body,author_id,author_kind) VALUES ('old-comment','pufu','old-pufu',1,'残す記録','alice','user')`,
    ),
    app.env.DB.prepare(
      `INSERT INTO pufu_image_links(token_hash,user_id,question_id,pufu_id,project_id,phase,revision,content_key,expires_at) VALUES ('old-token','alice','old-question','old-pufu','alice-project',1,1,'old-key','2099-01-01')`,
    ),
  ]);
  await applyMigration(app.env.DB, '0029_independent_pufus.sql');
  await applyMigration(app.env.DB, '0030_multiple_relations.sql');
  expect(
    await app.env.DB.prepare(
      "SELECT project_id,question_id FROM pufu_scores WHERE id='old-pufu'",
    ).first(),
  ).toEqual({ project_id: 'alice-project', question_id: 'old-question' });
  for (const table of ['pufu_phases', 'comments', 'pufu_image_links'])
    expect(await app.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).toEqual({
      n: 1,
    });
  await app.request('/api/v1/questions/old-question', {
    method: 'PATCH',
    body: { project_id: 'alice-second' },
  });
  expect(
    await app.env.DB.prepare("SELECT project_id FROM pufu_scores WHERE id='old-pufu'").first(),
  ).toEqual({ project_id: 'alice-second' });
  expect(await app.env.DB.prepare('PRAGMA foreign_key_check').all()).toMatchObject({ results: [] });
});
