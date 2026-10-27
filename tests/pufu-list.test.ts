import { afterEach, beforeEach, expect, it } from 'vitest';
import { testApp } from './helpers';
import type { Project } from '../shared/domain';

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

it('プロジェクト別のプ譜件数は独立したプ譜も含み、全体一覧と所有者・トークンの範囲に一致する', async () => {
  await app.env.DB.batch([
    app.env.DB.prepare(
      "INSERT INTO projects(id,user_id,name) VALUES ('empty','alice','空のプロジェクト')",
    ),
    app.env.DB.prepare(
      `INSERT INTO pufu_scores(id,user_id,project_id,task,input_json,editor_version)
      VALUES ('independent','alice','alice-second','独立した案','{}','0.9.19')`,
    ),
  ]);
  const projects = (
    (await (await app.request('/api/v1/projects')).json()) as {
      projects: Project[];
    }
  ).projects;
  expect(projects.find((project) => project.id === 'alice-second')).toMatchObject({
    pufu_count: 28,
  });
  expect(projects.find((project) => project.id === 'alice-project')).toMatchObject({
    pufu_count: 1,
  });
  expect(projects.find((project) => project.id === 'empty')).toMatchObject({ pufu_count: 0 });
  expect(projects.some((project) => project.id === 'bob-project')).toBe(false);
  const all = (await (await app.request('/api/v1/pufus')).json()) as { total: number };
  expect(
    projects
      .filter((project) => project.show_in_all_lists)
      .reduce((sum, project) => sum + project.pufu_count, 0),
  ).toBe(all.total);
  const { token } = (await (
    await app.request('/api/v1/tokens', {
      method: 'POST',
      body: { name: 'プ譜の件数', project_id: 'alice-project' },
    })
  ).json()) as { token: string };
  expect(
    await (
      await app.request('/api/v1/projects', {
        headers: { Authorization: `Bearer ${token}`, Cookie: '', Origin: '' },
      })
    ).json(),
  ).toMatchObject({ projects: [{ id: 'alice-project', pufu_count: 1 }] });
  expect(await (await app.request('/api/v1/projects', { user: 'bob' })).json()).toMatchObject({
    projects: [{ id: 'bob-project', pufu_count: 1 }],
  });
  await app.env.DB.prepare("DELETE FROM pufu_scores WHERE id='independent'").run();
  expect(await (await app.request('/api/v1/projects')).json()).toMatchObject({
    projects: expect.arrayContaining([
      expect.objectContaining({ id: 'alice-second', pufu_count: 27 }),
    ]),
  });
});

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
