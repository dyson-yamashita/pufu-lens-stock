import { afterEach, beforeEach, expect, it } from 'vitest';
import { testApp } from './helpers';

let app: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  app = await testApp();
  await app.env.DB.batch([
    app.env.DB.prepare("UPDATE projects SET show_in_all_lists=0 WHERE id='alice-project'"),
    app.env.DB.prepare(`INSERT INTO questions(id,project_id,source,text,status) VALUES
      ('visible','alice-second','user','実行を続けるには？','ready'),
      ('hidden','alice-project','user','非表示の問い','ready'),
      ('foreign','bob-project','user','他人の問い','ready')`),
    ...Array.from({ length: 27 }, (_, index) =>
      app.env.DB.prepare(
        `INSERT INTO pufu_scores
        (id,user_id,question_id,task,input_json,editor_version,status,created_at)
        VALUES (?,'alice','visible',?,'{"private":"snapshot"}','0.9.18',?,'2026-10-22T00:00:00Z')`,
      ).bind(
        `pufu-${String(index).padStart(2, '0')}`,
        `実行の案 ${index}`,
        ['ready', 'queued', 'generating', 'failed'][index % 4],
      ),
    ),
    app.env.DB
      .prepare(`INSERT INTO pufu_scores(id,user_id,question_id,task,input_json,editor_version)
      VALUES ('hidden-pufu','alice','hidden','非表示の案','{}','0.9.18'),
      ('foreign-pufu','bob','foreign','他人の案','{}','0.9.18')`),
  ]);
});
afterEach(async () => app.dispose());

it('本人のプ譜を状態を問わず新しい順に24件ずつ返し、全体非表示と他人のデータを除外する', async () => {
  const response = await app.request('/api/v1/pufus');
  expect(response.status).toBe(200);
  const first = (await response.json()) as { pufus: Record<string, unknown>[]; total: number };
  expect(first.total).toBe(27);
  expect(first.pufus).toHaveLength(24);
  expect(first.pufus[0]).toMatchObject({
    id: 'pufu-26',
    project_id: 'alice-second',
    question_id: 'visible',
    question_text: '実行を続けるには？',
    task: '実行の案 26',
    status: 'generating',
  });
  expect(new Set(first.pufus.map((pufu) => pufu.status)).size).toBe(4);
  expect(first.pufus.every((pufu) => !('input_json' in pufu) && !('score_json' in pufu))).toBe(
    true,
  );
  const second = await (await app.request('/api/v1/pufus?page=2')).json();
  expect(second).toMatchObject({
    pufus: [{ id: 'pufu-02' }, { id: 'pufu-01' }, { id: 'pufu-00' }],
    total: 27,
  });
});

it('指定した本人のプロジェクトだけ返し、全体非表示でも専用画面では表示する', async () => {
  const response = await app.request('/api/v1/pufus?project_id=alice-project');
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    pufus: [{ id: 'hidden-pufu', project_name: 'Alice project' }],
    total: 1,
  });
  for (const project of ['bob-project', 'missing'])
    expect((await app.request(`/api/v1/pufus?project_id=${project}`)).status).toBe(404);
  expect((await app.request('/api/v1/pufus', { headers: { Cookie: '' } })).status).toBe(401);
});
