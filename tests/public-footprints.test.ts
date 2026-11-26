import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it } from 'vitest';
import worker from '../server/index';
import type { Dependency } from '../server/features/memory/footprint-repository';
import type { PublicFootprintPage } from '../shared/footprints';
import { publicListPageSize } from '../shared/public-project';
import { testApp } from './helpers';

const project = 'alice-project';
const privateFootprints = `/api/v1/projects/${project}/footprints`;
const editPath = (revision: number) => `${privateFootprints}/${revision}/publication`;
const copy = { title: '公開する足あと <見直し>', summary: '公開用に書いた説明' };
const anonymous = { headers: { Cookie: '' } };
const analysis = JSON.stringify({
  analysis: {
    kind: 'deepening',
    title: 'PRIVATE_ANALYSIS',
    changes: [
      {
        text: 'PRIVATE_CHANGE',
        links: [{ kind: 'stock', id: 'PRIVATE_EVIDENCE', label: 'PRIVATE_NOTE' }],
      },
    ],
    interpretation: 'PRIVATE_AI_INTERPRETATION',
  },
  links: [{ kind: 'stock', id: 'PRIVATE_EVIDENCE', label: 'PRIVATE_NOTE' }],
});
const start = '2026-11-02T00:00:00.000Z';
const end = '2026-11-05T00:00:00.000Z';
let app: Awaited<ReturnType<typeof testApp>>;

beforeEach(async () => {
  app = await testApp();
});
afterEach(async () => {
  await app.dispose();
});

function point(
  revision: number,
  dependencies: Dependency[] = [],
  result: string | null = analysis,
) {
  return app.env.DB.prepare(
    `INSERT INTO project_footprints(project_id,revision,revisions,start_at,end_at,update_count,job_id,result_json,dependencies,evidence_ids,model,created_at)
     VALUES (?,?,'[]',?,?,3,?,?,?,'["PRIVATE_EVIDENCE"]','PRIVATE_MODEL',?)`,
  ).bind(
    project,
    revision,
    start,
    end,
    `fixture-footprint-${revision}`,
    result,
    JSON.stringify(dependencies),
    end,
  );
}

async function share(id = project, is_public = true) {
  const response = await app.request(`/api/v1/projects/${id}/publication`, {
    method: 'PATCH',
    body: { is_public, public_description: '' },
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { publication: { public_id: string } }).publication.public_id;
}

const get = (key: string, page = 1) =>
  app.request(`/api/public/projects/${key}/footprints?page=${page}`, anonymous);
const publish = (revision: number, data = copy) =>
  app.request(editPath(revision), { method: 'PATCH', body: data });

it('個別に承認された足あとだけを匿名APIと公開HTMLで返し、分析と根拠を公開しない', async () => {
  await app.env.DB.batch([point(1), point(2)]);
  const key = await share();
  expect(await (await get(key)).json()).toEqual({ items: [], page: 1, has_more: false });
  expect(await (await publish(2)).json()).toEqual({ publication: copy });
  const response = await get(key);
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual({
    items: [{ id: expect.any(String), start_at: start, end_at: end, kind: 'deepening', ...copy }],
    page: 1,
    has_more: false,
  });
  expect(await (await get(await share('alice-second'))).json()).toMatchObject({ items: [] });
  expect(await (await app.request(`${privateFootprints}/2`)).json()).toMatchObject({
    analysis: { title: 'PRIVATE_ANALYSIS' },
    publication_enabled: true,
    publication: copy,
  });

  const template = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  app.env.ASSETS = { fetch: async () => new Response(template) } as unknown as Fetcher;
  const render = () =>
    worker.fetch(new Request(`${app.env.APP_URL}/p/${key}?view=footprints`), app.env, app.ctx);
  const rendered = await render();
  expect(rendered.status).toBe(200);
  expect(rendered.headers.get('Cache-Control')).toBe('no-store');
  const html = await rendered.text();
  const { document } = parseHTML(html);
  expect(document.querySelector('article h3')?.textContent).toBe(copy.title);
  expect(html).toContain('&lt;見直し&gt;');
  expect(html).not.toContain('PRIVATE_');

  expect((await app.request(editPath(2), { method: 'DELETE' })).status).toBe(200);
  expect(await (await get(key)).json()).toMatchObject({ items: [] });
  expect(await (await render()).text()).not.toContain(copy.summary);
  expect(await (await app.request(`${privateFootprints}/2`)).json()).toMatchObject({
    analysis: { title: 'PRIVATE_ANALYSIS' },
    publication: null,
  });
});

it('本人の同一Originセッションだけが足あとの公開内容を変更・取り消せる', async () => {
  await point(1).run();
  expect((await publish(1)).status).toBe(404);
  const key = await share();
  expect((await publish(1)).status).toBe(200);
  for (const method of ['PATCH', 'DELETE']) {
    const body = method === 'PATCH' ? { ...copy, title: '権限のない変更' } : undefined;
    expect((await app.request(editPath(1), { method, body, ...anonymous })).status).toBe(401);
    expect((await app.request(editPath(1), { method, body, user: 'bob' })).status).toBe(404);
    expect(
      (
        await app.request(editPath(1), {
          method,
          body,
          headers: { Origin: 'https://outside.example' },
        })
      ).status,
    ).toBe(403);
  }
  expect(
    (
      await app.request(editPath(1), {
        method: 'PATCH',
        body: { ...copy, analysis },
      })
    ).status,
  ).toBe(400);
  expect(await (await get(key)).json()).toMatchObject({ items: [copy] });
  const revised = { ...copy, summary: '修正済みの公開説明' };
  expect(await (await publish(1, revised)).json()).toEqual({ publication: revised });
  expect(await (await get(key)).json()).toMatchObject({ items: [revised] });
});

it('掲載済みの「続く」は日付と分類だけを公開ページに返す', async () => {
  const stored = JSON.parse(analysis);
  stored.analysis.kind = 'continuing';
  await point(1, [], JSON.stringify(stored)).run();
  const key = await share();
  expect((await publish(1)).status).toBe(200);
  expect(await (await get(key)).json()).toEqual({
    items: [{ id: expect.any(String), end_at: end, kind: 'continuing' }],
    page: 1,
    has_more: false,
  });
  expect((await app.request(`${privateFootprints}/1`)).status).toBe(404);
  const template = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  app.env.ASSETS = { fetch: async () => new Response(template) } as unknown as Fetcher;
  const response = await worker.fetch(
    new Request(`${app.env.APP_URL}/p/${key}?view=footprints`),
    app.env,
    app.ctx,
  );
  const html = await response.text();
  expect(parseHTML(html).document.querySelector('article')?.textContent).toContain('続く');
  expect(html).not.toContain(copy.title);
  expect(html).not.toContain(copy.summary);
  expect(html).not.toContain('PRIVATE_');
});

it('公開データから生成した分析を、同じ根拠と観点で本人・匿名APIと公開HTMLに表示する', async () => {
  const source = { kind: 'question', id: 'shared-question', label: '公開された問い' };
  const shared = {
    analysis: {
      ...JSON.parse(analysis).analysis,
      title: '公開された分析 <確認>',
      before: '以前の見方',
      current: '追加された判断材料',
      changes: [{ text: '問いの範囲が広がった。', links: [source] }],
      interpretation: '記録から分かる解釈',
      perspectives: { questions: '新たに比較できる問い' },
    },
    links: [source],
  };
  await app.env.DB.batch([
    point(1, [], JSON.stringify(shared)),
    app.env.DB.prepare(
      `INSERT INTO questions(id,project_id,source,text,status,updated_at)
      VALUES (?1,?2,'user','公開された問い','ready',?3)`,
    ).bind(source.id, project, start),
    app.env.DB.prepare(
      'UPDATE project_footprints SET public_id=?,dependencies=? WHERE project_id=? AND revision=1',
    ).bind(
      'shared-id',
      JSON.stringify([{ kind: 'question', id: source.id, version: '[null,null]' }]),
      project,
    ),
  ]);
  const key = await share();
  const item = { ...shared, start_at: start, end_at: end, kind: 'deepening' };
  expect(await (await get(key)).json()).toMatchObject({ items: [{ id: 'shared-id', ...item }] });
  expect(await (await app.request(`${privateFootprints}/1`)).json()).toMatchObject({
    shared: item,
  });
  const template = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  app.env.ASSETS = { fetch: async () => new Response(template) } as unknown as Fetcher;
  const response = await worker.fetch(
    new Request(`${app.env.APP_URL}/p/${key}?view=footprints`),
    app.env,
    app.ctx,
  );
  const html = await response.text();
  const { document } = parseHTML(html);
  expect(document.querySelector('article h3')?.textContent).toBe(shared.analysis.title);
  expect(document.querySelector('article dl dd')?.textContent).toBe('新たに比較できる問い');
  expect(document.querySelector('article a')?.getAttribute('href')).toBe(
    `/p/${key}/questions/${source.id}`,
  );
  expect(html).toContain('&lt;確認&gt;');
  await app.env.DB.prepare("UPDATE questions SET note='個人用のメモ',updated_at=? WHERE id=?")
    .bind(end, source.id)
    .run();
  expect(await (await get(key)).json()).toMatchObject({ items: [{ id: 'shared-id', ...item }] });
  await app.env.DB.prepare("UPDATE questions SET status='failed' WHERE id=?").bind(source.id).run();
  expect(await (await get(key)).json()).toMatchObject({ items: [] });
});

it('根拠の削除、メモリ更新オフ、プロジェクトの非公開化・削除を取得時に反映する', async () => {
  const dependencies = [
    { kind: 'question', id: 'source', version: JSON.stringify([start, null]) },
    {
      kind: 'comment',
      id: 'comment',
      version: JSON.stringify(['question', 'source', null, start, null]),
    },
    { kind: 'phase', id: JSON.stringify(['pufu', 1]), version: JSON.stringify([start, null]) },
  ];
  await app.env.DB.batch([
    app.env.DB.prepare(
      "INSERT INTO questions(id,project_id,source,text,status,updated_at) VALUES ('source',?,'user','非公開の分析根拠','ready',?)",
    ).bind(project, start),
    app.env.DB.prepare(
      "INSERT INTO comments(id,target_type,target_id,author_id,body,created_at) VALUES ('comment','question','source','alice','非公開のメモ',?)",
    ).bind(start),
    app.env.DB.prepare(
      "INSERT INTO pufu_scores(id,user_id,project_id,task,input_json,score_json,editor_version,status,current_phase) VALUES ('pufu','alice',?,'非公開の課題','{}','{}','0.9.19','ready',1)",
    ).bind(project),
    app.env.DB.prepare(
      "INSERT INTO pufu_phases(pufu_id,number,score_json,created_at,updated_at) VALUES ('pufu',1,'{}',?,?)",
    ).bind(start, start),
    point(1, dependencies),
    point(2, [], null),
  ]);
  const key = await share();
  expect((await publish(2)).status).toBe(404);
  expect((await publish(1)).status).toBe(200);
  const memory = (enabled: boolean) =>
    app.request(`/api/v1/projects/${project}`, {
      method: 'PATCH',
      body: { name: 'Alice project', include_in_user_memory: enabled },
    });
  expect((await memory(false)).status).toBe(200);
  expect(await (await get(key)).json()).toMatchObject({ items: [] });
  expect((await publish(1, { ...copy, summary: '掲載停止中の変更' })).status).toBe(404);
  expect((await memory(true)).status).toBe(200);
  expect(await (await get(key)).json()).toMatchObject({ items: [copy] });
  expect(await share(project, false)).toBe(key);
  expect((await get(key)).status).toBe(404);
  expect(await share()).toBe(key);
  expect((await app.request('/api/v1/questions/source', { method: 'DELETE' })).status).toBe(200);
  expect(await (await get(key)).json()).toMatchObject({ items: [] });
  expect((await publish(1)).status).toBe(404);
  expect((await app.request(`/api/v1/projects/${project}`, { method: 'DELETE' })).status).toBe(200);
  expect((await get(key)).status).toBe(404);
  expect(
    await app.env.DB.prepare('SELECT id FROM project_footprint_publications').first(),
  ).toBeNull();
});

it('同日の足あとが複数ページにまたがっても重複や取りこぼしがない', async () => {
  const key = await share();
  const revisions = Array.from({ length: publicListPageSize + 1 }, (_, i) => i + 1);
  await app.env.DB.batch(revisions.map((revision) => point(revision)));
  for (const revision of revisions) {
    expect((await publish(revision, { ...copy, title: String(revision) })).status).toBe(200);
  }
  const latest = (await (await get(key)).json()) as PublicFootprintPage;
  expect(latest.has_more).toBe(true);
  expect(latest.items.map((item) => ('title' in item ? Number(item.title) : null))).toEqual(
    revisions.slice(1).reverse(),
  );
  const past = (await (await get(key, 2)).json()) as PublicFootprintPage;
  expect(past.has_more).toBe(false);
  expect(past.items.map((item) => ('title' in item ? item.title : null))).toEqual(['1']);
});
