import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readdir } from 'node:fs/promises';
import { testApp, applyMigration, mockEvent, mockStep } from './helpers';
import { ArticleWorkflow } from '../server/workflows';
import { readQuestionPufu } from '../server/pufu-read';
import * as relations from '../server/relations';
import { elementKeys } from '../shared/pufu';
import score from './fixtures/pufu-sparse.json';
let app: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  app = await testApp();
  for (const id of ['s1', 's2', 'foreign']) {
    await app.env.DB.batch([
      app.env.DB.prepare(
        'INSERT INTO articles(id,user_id,canonical_url,source_url,domain,status,title) VALUES (?,?,?,?,?,?,?)',
      ).bind(
        `a-${id}`,
        id === 'foreign' ? 'bob' : 'alice',
        `https://example.com/${id}`,
        `https://example.com/${id}`,
        'example.com',
        'ready',
        id,
      ),
      app.env.DB.prepare(
        'INSERT INTO stocks(id,user_id,project_id,article_id,note) VALUES (?,?,?,?,?)',
      ).bind(
        id,
        id === 'foreign' ? 'bob' : 'alice',
        id === 'foreign' ? 'bob-project' : 'alice-project',
        `a-${id}`,
        '',
      ),
    ]);
  }
  await app.env.DB.prepare(
    "INSERT INTO questions(id,project_id,source,text,status) VALUES ('q1','alice-project','user','問い1','ready'),('q2','alice-project','user','問い2','ready'),('other','alice-second','user','別の問い','ready')",
  ).run();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.dispose();
});
async function create(data = {}) {
  const response = await app.request('/api/v1/pufus', {
    method: 'POST',
    body: { project_id: 'alice-project', score, request_id: crypto.randomUUID(), ...data },
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { pufu: { id: string } }).pufu.id;
}
it('プ譜へ複数の問いとストックを保存し、第二の問いからも取得できる', async () => {
  const id = await create({ question_ids: ['q1', 'q2'], stock_ids: ['s1', 's2'] });
  expect(await (await app.request(`/api/v1/pufus/${id}`)).json()).toMatchObject({
    pufu: {
      question_ids: ['q1', 'q2'],
      stock_ids: ['s1', 's2'],
      questions: [{ id: 'q1' }, { id: 'q2' }],
      stocks: [{ id: 's1' }, { id: 's2' }],
    },
  });
  expect(await (await app.request('/api/v1/questions/q2')).json()).toMatchObject({
    pufus: [{ id }],
  });
  expect(await (await app.request(`/api/v1/questions/q2/pufu/${id}`)).json()).toMatchObject({
    pufu_id: id,
    question_id: 'q2',
    projectScore: score,
  });
  expect(await (await app.request('/api/v1/pufus')).json()).toMatchObject({
    total: 1,
    pufus: [{ id, questions: [{ id: 'q1' }, { id: 'q2' }] }],
  });
  const update = (revision: number, question_ids: string[], stock_ids: string[]) =>
    app.request(`/api/v1/pufus/${id}/relations`, {
      method: 'PATCH',
      body: { revision, question_ids, stock_ids },
    });
  expect((await update(1, ['q2'], ['s2'])).status).toBe(200);
  expect((await update(1, [], [])).status).toBe(409);
  expect(await (await app.request(`/api/v1/pufus/${id}`)).json()).toMatchObject({
    pufu: { revision: 2, question_ids: ['q2'], stock_ids: ['s2'] },
  });
  expect((await update(2, ['other'], ['s2'])).status).toBe(404);
  expect((await update(2, ['q2'], ['foreign'])).status).toBe(404);
  expect((await update(2, [], [])).status).toBe(200);
});
it('問いへ複数ストックを保存し、第二のストックにも表示、選択を更新できる', async () => {
  const request_id = crypto.randomUUID();
  const body = {
    project_id: 'alice-project',
    stock_ids: ['s1', 's2'],
    text: '複数の記事から考える',
    request_id,
  };
  const response = await app.request('/api/v1/questions', { method: 'POST', body });
  expect(response.status).toBe(201);
  const { question } = (await response.json()) as { question: { id: string } };
  expect((await app.request('/api/v1/questions', { method: 'POST', body })).status).toBe(200);
  expect(
    (
      await app.request('/api/v1/questions', {
        method: 'POST',
        body: { ...body, stock_ids: ['s1'] },
      })
    ).status,
  ).toBe(409);
  expect(await (await app.request(`/api/v1/questions/${question.id}`)).json()).toMatchObject({
    question: { stock_ids: ['s1', 's2'] },
  });
  expect(await (await app.request('/api/v1/stocks/s2/question')).json()).toMatchObject({
    questions: expect.arrayContaining([expect.objectContaining({ id: question.id })]),
  });
  expect(
    (
      await app.request(`/api/v1/questions/${question.id}`, {
        method: 'PATCH',
        body: { stock_ids: ['s2'] },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await app.request(`/api/v1/questions/${question.id}`, {
        method: 'PATCH',
        body: { stock_ids: ['foreign'] },
      })
    ).status,
  ).toBe(404);
});
it('問いやストックを削除しても共有されたプ譜・局面は残す', async () => {
  const id = await create({ question_ids: ['q1', 'q2'], stock_ids: ['s1', 's2'] });
  await app.request('/api/v1/questions/q1', { method: 'DELETE' });
  await app.request('/api/v1/stocks/s1', { method: 'DELETE' });
  expect(await (await app.request(`/api/v1/pufus/${id}`)).json()).toMatchObject({
    pufu: { question_ids: ['q2'], stock_ids: ['s2'], phases: [{ number: 1, score }] },
  });
  expect(await app.env.DB.prepare('PRAGMA foreign_key_check').all()).toMatchObject({ results: [] });
});
it('移行は生成元の関連とプ譜の局面・コメントを引き継ぐ', async () => {
  await app.dispose();
  const migrations = (await readdir(new URL('../migrations/', import.meta.url)))
    .filter((name) => name.endsWith('.sql') && name < '0030')
    .sort();
  app = await testApp({ migrations });
  await app.env.DB.batch([
    app.env.DB.prepare(
      "INSERT INTO articles(id,user_id,title,canonical_url,source_url,domain,status) VALUES ('a','alice','記事','https://example.com/a','https://example.com/a','example.com','ready')",
    ),
    app.env.DB.prepare(
      "INSERT INTO stocks(id,user_id,project_id,article_id,note) VALUES ('s','alice','alice-project','a','')",
    ),
    app.env.DB.prepare(
      "INSERT INTO questions(id,project_id,stock_id,text,source,status) VALUES ('q','alice-project','s','旧問い','user','ready')",
    ),
    app.env.DB.prepare(
      "INSERT INTO pufu_scores(id,user_id,project_id,question_id,task,input_json,score_json,editor_version,status) VALUES ('pf','alice','alice-project','q','目標','{}',?,'0.9.19','ready')",
    ).bind(JSON.stringify(score)),
    app.env.DB.prepare(
      "INSERT INTO pufu_phases(pufu_id,number,score_json,created_at,updated_at) VALUES ('pf',1,?,'2026-10-20','2026-10-20')",
    ).bind(JSON.stringify(score)),
    app.env.DB.prepare(
      "INSERT INTO comments(id,target_type,target_id,phase,body,author_id) VALUES ('c','pufu','pf',1,'記録','alice')",
    ),
  ]);
  await applyMigration(app.env.DB, '0030_multiple_relations.sql');
  expect(await app.env.DB.prepare('SELECT * FROM question_stocks').all()).toMatchObject({
    results: [{ question_id: 'q', stock_id: 's' }],
  });
  expect(await app.env.DB.prepare('SELECT * FROM pufu_questions').all()).toMatchObject({
    results: [{ pufu_id: 'pf', question_id: 'q' }],
  });
  expect(await app.env.DB.prepare('SELECT * FROM pufu_stocks').all()).toMatchObject({
    results: [{ pufu_id: 'pf', stock_id: 's' }],
  });
  expect(await app.env.DB.prepare("SELECT COUNT(*) n FROM comments WHERE id='c'").first()).toEqual({
    n: 1,
  });
  expect(await app.env.DB.prepare('PRAGMA foreign_key_check').all()).toMatchObject({ results: [] });
});
it('公開ページも第二の関連をたどり、解除・非公開後には公開しない', async () => {
  await app.env.DB.prepare("UPDATE questions SET stock_id='s1' WHERE id='q1'").run();
  await app.request('/api/v1/questions/q1', { method: 'PATCH', body: { stock_ids: ['s1', 's2'] } });
  const id = await create({ question_ids: ['q1', 'q2'], stock_ids: ['s1', 's2'] });
  const response = await app.request('/api/v1/projects/alice-project/publication', {
    method: 'PATCH',
    body: { is_public: true, public_description: '' },
  });
  const { publication } = (await response.json()) as { publication: { public_id: string } };
  const root = `/api/public/projects/${publication.public_id}`;
  const read = (path: string) => app.request(root + path, { headers: { Cookie: '' } });
  expect(await (await read('/stocks/s2')).json()).toMatchObject({
    total: 1,
    questions: [{ id: 'q1', stock_ids: ['s1', 's2'] }],
  });
  expect(await (await read('/questions/q2')).json()).toMatchObject({
    question: { pufu_count: 1 },
    pufus: [{ id }],
  });
  expect(await (await read(`/pufus/${id}`)).json()).toMatchObject({
    pufu: { question_ids: ['q1', 'q2'], stock_ids: ['s1', 's2'], score },
  });
  await app.request('/api/v1/questions/q1', { method: 'PATCH', body: { stock_ids: ['s2'] } });
  expect(await (await read('/stocks/s2')).json()).toMatchObject({ total: 1 });
  await app.request(`/api/v1/pufus/${id}/relations`, {
    method: 'PATCH',
    body: { revision: 1, question_ids: [], stock_ids: ['s2'] },
  });
  expect((await read(`/pufus/${id}`)).status).toBe(404);
  await app.request('/api/v1/projects/alice-project/publication', {
    method: 'PATCH',
    body: { is_public: false, public_description: '' },
  });
  expect((await read('/stocks/s2')).status).toBe(404);
});
it('保存の競合・不正なIDでは関連も局面も変更せず、共有中のプロジェクト移動を拒否する', async () => {
  const id = await create({ question_ids: ['q1', 'q2'], stock_ids: ['s1', 's2'] });
  const edit = (revision: number, fields = {}) =>
    app.request(`/api/v1/pufus/${id}`, {
      method: 'PATCH',
      body: { revision, score, question_ids: ['q2'], stock_ids: ['s2'], ...fields },
    });
  expect((await edit(99)).status).toBe(409);
  expect((await edit(1, { question_ids: ['other'] })).status).toBe(404);
  expect((await edit(1, { question_id: 'q1' })).status).toBe(400);
  expect(await (await app.request(`/api/v1/pufus/${id}`)).json()).toMatchObject({
    pufu: { revision: 1, question_ids: ['q1', 'q2'], stock_ids: ['s1', 's2'] },
  });
  expect(
    (
      await app.request('/api/v1/questions/q1', {
        method: 'PATCH',
        body: { project_id: 'alice-second' },
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await app.request('/api/v1/stocks/s1', {
        method: 'PATCH',
        body: { project_id: 'alice-second', note: '' },
      })
    ).status,
  ).toBe(409);
  expect((await edit(1)).status).toBe(200);
  expect(await (await app.request(`/api/v1/pufus/${id}`)).json()).toMatchObject({
    pufu: { revision: 2, question_ids: ['q2'], stock_ids: ['s2'] },
  });
});
it('配列の重複を除去して再送を同一視し、旧単一IDと配列の併用を拒否する', async () => {
  const request_id = crypto.randomUUID();
  const body = {
    project_id: 'alice-project',
    request_id,
    score,
    question_ids: ['q2', 'q1', 'q2'],
    stock_ids: ['s2', 's1'],
  };
  expect((await app.request('/api/v1/pufus', { method: 'POST', body })).status).toBe(201);
  expect(
    (
      await app.request('/api/v1/pufus', {
        method: 'POST',
        body: { ...body, question_ids: ['q1', 'q2'], stock_ids: ['s1', 's2'] },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await app.request('/api/v1/pufus', {
        method: 'POST',
        body: { ...body, question_ids: ['q1'] },
      })
    ).status,
  ).toBe(409);
  expect(
    (await app.request('/api/v1/pufus', { method: 'POST', body: { ...body, question_id: 'q1' } }))
      .status,
  ).toBe(400);
  expect(
    (
      await app.request('/api/v1/pufus', {
        method: 'POST',
        body: { ...body, question_ids: Array(101).fill('q1') },
      })
    ).status,
  ).toBe(400);
});
it('関連AI問いの再生成中や失敗中も既存のプ譜を保存でき、新しい未完成の問いは紐づけない', async () => {
  const id = await create({ question_ids: ['q1'], stock_ids: ['s1'] });
  for (const [revision, status] of [
    [1, 'generating'],
    [2, 'failed'],
  ] as const) {
    await app.env.DB.prepare(
      "UPDATE questions SET status=?,source='ai',stock_id='s1' WHERE id='q1'",
    )
      .bind(status)
      .run();
    expect(
      (await app.request(`/api/v1/pufus/${id}`, { method: 'PATCH', body: { revision, score } }))
        .status,
    ).toBe(200);
  }
  expect(
    (
      await app.request(`/api/v1/pufus/${id}/relations`, {
        method: 'PATCH',
        body: { revision: 3, question_ids: ['q1', 'q2'], stock_ids: ['s1', 's2'] },
      })
    ).status,
  ).toBe(200);
  const other = await create();
  expect(
    (
      await app.request(`/api/v1/pufus/${other}/relations`, {
        method: 'PATCH',
        body: { revision: 1, question_ids: ['q1'], stock_ids: [] },
      })
    ).status,
  ).toBe(404);
});
it('問い作成の再送は元ストック削除後も同じ問いを返す', async () => {
  const body = {
    project_id: 'alice-project',
    stock_ids: ['s1', 's2'],
    text: '再送する問い',
    request_id: crypto.randomUUID(),
  };
  const first = await app.request('/api/v1/questions', { method: 'POST', body });
  expect(first.status).toBe(201);
  const { question } = (await first.json()) as { question: { id: string } };
  await app.request('/api/v1/stocks/s1', { method: 'DELETE' });
  const repeated = await app.request('/api/v1/questions', { method: 'POST', body });
  expect(repeated.status).toBe(200);
  expect(await repeated.json()).toMatchObject({ question: { id: question.id, stock_ids: ['s2'] } });
});
it('問いからの作成は1問だけを設定し、複数ストックを関連・生成時の文脈へ引き継ぐ', async () => {
  const response = await app.request('/api/v1/questions', {
    method: 'POST',
    body: { project_id: 'alice-project', stock_ids: ['s1', 's2'], text: '複数から考える' },
  });
  const { question } = (await response.json()) as { question: { id: string } };
  const created = await app.request(`/api/v1/questions/${question.id}/pufus`, {
    method: 'POST',
    body: { task: '複数の根拠を活かす', request_id: crypto.randomUUID() },
  });
  expect(created.status).toBe(202);
  const { id } = (await created.json()) as { id: string };
  expect(await (await app.request(`/api/v1/pufus/${id}`)).json()).toMatchObject({
    pufu: {
      question_ids: [question.id],
      stock_ids: ['s1', 's2'],
      context: { question: { id: question.id }, stocks: [{ id: 's1' }, { id: 's2' }] },
    },
  });
});
it('長い要約100件の関連を保ち、生成時の永続ステップとAIへの参照入力を制限内に保つ', async () => {
  const ids = Array.from({ length: 100 }, (_, index) => `large-${String(index).padStart(3, '0')}`);
  const summary = JSON.stringify({
    overview: '概'.repeat(1600),
    keyPoints: Array(8).fill('点'.repeat(500)),
    topics: Array(8).fill('題'.repeat(40)),
  });
  await app.env.DB.batch(
    ids.flatMap((id) => [
      app.env.DB.prepare(
        "INSERT INTO articles(id,user_id,canonical_url,source_url,title,domain,status,summary_json) VALUES (?,'alice',?,'',?,'','ready',?)",
      ).bind(id, id, '記'.repeat(200), summary),
      app.env.DB.prepare(
        "INSERT INTO stocks(id,user_id,project_id,article_id,note) VALUES (?,'alice','alice-project',?,?)",
      ).bind(id, id, 'メ'.repeat(2000)),
    ]),
  );
  const q = await app.request('/api/v1/questions', {
    method: 'POST',
    body: { project_id: 'alice-project', stock_ids: ids, text: '全資料をつなぐ問い' },
  });
  const { question } = (await q.json()) as { question: { id: string } };
  const response = await app.request(`/api/v1/questions/${question.id}/pufus`, {
    method: 'POST',
    body: { task: '全資料を見て考える', request_id: crypto.randomUUID() },
  });
  expect(response.status).toBe(202);
  const { id } = (await response.json()) as { id: string };
  const draft = {
    winCondition: '達成を検証できる',
    purposes: [{ text: '仮説がある', measures: [{ text: '検証する', color: 'blue' }] }],
    elements: Object.fromEntries(elementKeys.map((key) => [key, '確認する'])),
  };
  const ai = vi.fn(async () => ({ response: JSON.stringify(draft) }));
  app.env.AI = { run: ai };
  await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(`pufu-job-${id}-1`), mockStep(2 ** 20));
  const { pufu } = (await (await app.request(`/api/v1/pufus/${id}`)).json()) as {
    pufu: { status: string; stock_ids: string[]; context: { stocks: { id: string }[] } };
  };
  expect(pufu.status).toBe('ready');
  expect(pufu.stock_ids).toEqual(ids);
  expect(pufu.context.stocks.map((stock) => stock.id)).toEqual(ids);
  const [, input] = ai.mock.calls[0] as unknown as [string, { messages: { content: string }[] }];
  const prompt = JSON.parse(input.messages[1].content) as { stocks: unknown[] };
  expect(prompt.stocks).toHaveLength(100);
  expect(JSON.stringify(prompt.stocks).length).toBeLessThanOrEqual(14000);
});
it('限定接続の読み取り途中に移動しても、移動先で追加された問いの本文を混ぜない', async () => {
  const id = await create({ question_ids: ['q1'] });
  await app.env.DB.prepare(
    "UPDATE questions SET text='PRIVATE_SECOND_PROJECT' WHERE id='other'",
  ).run();
  const original = relations.pufuRelations;
  vi.spyOn(relations, 'pufuRelations').mockImplementationOnce(async (env, pufuId) => {
    await app.request('/api/v1/questions/q1', {
      method: 'PATCH',
      body: { project_id: 'alice-second' },
    });
    await app.request(`/api/v1/pufus/${id}/relations`, {
      method: 'PATCH',
      body: { revision: 1, question_ids: ['other'], stock_ids: [] },
    });
    return original(env, pufuId);
  });
  const result = await readQuestionPufu(
    app.env,
    {
      kind: 'mcp',
      tokenProjectId: 'alice-project',
      user: { id: 'alice', name: 'Alice', email: 'alice@example.com', bio: '', avatar_url: null },
    },
    'q1',
    id,
  );
  expect(JSON.stringify(result)).not.toContain('PRIVATE_SECOND_PROJECT');
  expect(result).toMatchObject({ questions: [{ id: 'q1', text: '問い1' }] });
});
