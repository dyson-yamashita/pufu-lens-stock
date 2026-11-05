import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { testApp, mockEvent, mockStep } from './helpers';
import { ArticleWorkflow } from '../server/workflows';
import { elementKeys, type Pufu } from '../shared/pufu';
import { snapshotStocks } from '../server/pufu-context';
import { generatePufu } from '../server/pufu';
import { generationInput, resolveQuote } from '../server/pufu-grounding';
import type { PufuContext } from '../shared/pufu';
import savedScore from './fixtures/pufu-sparse.json';

let app: Awaited<ReturnType<typeof testApp>>;
const draft = {
  gainingGoal: '仮説：問い合わせ対応を少人数で継続できる仕組みをつくる。',
  winCondition: '担当者が対応結果を確認できる。',
  purposes: [{ text: '必要な支援が分かる。', measures: [] }],
  elements: Object.fromEntries(elementKeys.map((key) => [key, null])),
};
beforeEach(async () => {
  app = await testApp();
  app.env.LOCAL_DEMO_ENABLED = 'true';
  await app.env.DB.batch([
    app.env.DB.prepare(
      `INSERT INTO articles(id,user_id,canonical_url,source_url,title,domain,status,content_key,input_text,summary_json)
       VALUES ('a1','alice','text:one','','支援の計画','','ready','body-one',NULL,?),
       ('a2','alice','text:two','','試験結果','','ready',NULL,'本文にだけある試験結果：担当2名で運用できた。',NULL)`,
    ).bind(JSON.stringify({ overview: '支援を改善する。', keyPoints: [], topics: [] })),
    app.env.DB.prepare(
      `INSERT INTO stocks(id,user_id,project_id,article_id,note) VALUES
       ('s1','alice','alice-project','a1','月3万円まで。'),
       ('s2','alice','alice-project','a2','')`,
    ),
    app.env.DB.prepare(
      `INSERT INTO questions(id,project_id,source,text,status) VALUES
       ('q1','alice-project','user','問い合わせ対応をどう改善する？','ready'),
       ('q2','alice-project','user','少人数で継続するには？','ready'),
       ('pending','alice-project','user',NULL,'queued'),
       ('foreign','bob-project','user','他人の問い','ready')`,
    ),
    app.env.DB.prepare("INSERT INTO question_stocks(question_id,stock_id) VALUES ('q1','s1')"),
  ]);
  await app.env.CONTENT.put(
    'body-one',
    '本文にだけある制約：既存の窓口を使って来月末までに検証する。',
  );
});
afterEach(async () => app.dispose());
const create = (
  body: Record<string, unknown>,
  path = '/api/v1/projects/alice-project/pufus/generate',
) => app.request(path, { method: 'POST', body: { request_id: crypto.randomUUID(), ...body } });
it.each([{ question_ids: ['q1', 'q2'] }, { stock_ids: ['s1', 's2'] }])(
  'プ譜作成は問い・ストックそれぞれ1件を超えた指定を拒否する: %j',
  async (refs) => {
    expect((await create({ task: '目標', ...refs })).status).toBe(400);
    expect((await app.env.DB.prepare('SELECT id FROM pufu_scores').all()).results).toEqual([]);
  },
);
it('選択したストック1件だけを参照し、問いの別の関連ストックを追加しない', async () => {
  const response = await create({ question_ids: ['q1'], stock_ids: ['s2'] });
  expect(response.status).toBe(202);
  const { id } = (await response.json()) as { id: string };
  expect(await get(id)).toMatchObject({
    question_ids: ['q1'],
    stock_ids: ['s2'],
    context: { stocks: [{ id: 's2' }] },
  });
  expect((await get(id)).context.stocks).toHaveLength(1);
});
it('問いの関連ストックが複数なら、明示的な1件の選択を求める', async () => {
  await app.env.DB.prepare(
    "INSERT INTO question_stocks(question_id,stock_id) VALUES ('q1','s2')",
  ).run();
  expect((await create({ question_ids: ['q1'] })).status).toBe(400);
  expect((await create({ question_ids: ['q1'], stock_ids: ['s2'] })).status).toBe(202);
});
it('問いの作成元と別の問いを同時指定して2件に増やせない', async () => {
  expect((await create({ question_ids: ['q2'] }, '/api/v1/questions/q1/pufus')).status).toBe(400);
});
it('保存APIの旧question_id経由でも複数ストックを自動追加しない', async () => {
  await app.env.DB.prepare(
    "INSERT INTO question_stocks(question_id,stock_id) VALUES ('q1','s2')",
  ).run();
  const body = {
    project_id: 'alice-project',
    question_id: 'q1',
    score: savedScore,
    request_id: crypto.randomUUID(),
  };
  expect((await app.request('/api/v1/pufus', { method: 'POST', body })).status).toBe(400);
  expect(
    (await app.request('/api/v1/pufus', { method: 'POST', body: { ...body, stock_ids: ['s2'] } }))
      .status,
  ).toBe(201);
});
it.each(['question_ids', 'stock_ids'])(
  '保存・編集・局面追加の%sも1件までに制限する',
  async (field) => {
    const refs = { [field]: field === 'question_ids' ? ['q1', 'q2'] : ['s1', 's2'] };
    const body = {
      project_id: 'alice-project',
      score: savedScore,
      request_id: crypto.randomUUID(),
    };
    expect(
      (await app.request('/api/v1/pufus', { method: 'POST', body: { ...body, ...refs } })).status,
    ).toBe(400);
    const created = await app.request('/api/v1/pufus', { method: 'POST', body });
    const { pufu } = (await created.json()) as { pufu: { id: string } };
    for (const [path, method, input] of [
      [
        `/api/v1/pufus/${pufu.id}/relations`,
        'PATCH',
        { revision: 1, question_ids: [], stock_ids: [], ...refs },
      ],
      [`/api/v1/pufus/${pufu.id}`, 'PATCH', { revision: 1, score: savedScore, ...refs }],
      [
        `/api/v1/pufus/${pufu.id}/phases`,
        'POST',
        { revision: 1, phase: 1, score: savedScore, ...refs },
      ],
    ] as const)
      expect((await app.request(path, { method, body: input })).status).toBe(400);
  },
);
async function get(id: string) {
  return ((await (await app.request(`/api/v1/pufus/${id}`)).json()) as { pufu: Pufu }).pufu;
}
async function run(id: string) {
  await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(`pufu-job-${id}-1`), mockStep(2 ** 20));
}

it('選択した問い1件とストック本文1件を渡し、空欄の獲得目標を推測して保存する', async () => {
  const request_id = crypto.randomUUID();
  const body = { request_id, question_ids: ['q1'], stock_ids: ['s1'], task: '' };
  const response = await create(body);
  expect(response.status).toBe(202);
  const { id } = (await response.json()) as { id: string };
  const ai = vi.fn(async () => ({ response: JSON.stringify(draft) }));
  app.env.AI = { run: ai };
  await run(id);
  const saved = await get(id);
  expect(saved).toMatchObject({
    status: 'ready',
    task: draft.gainingGoal,
    question_ids: ['q1'],
    stock_ids: ['s1'],
    score: { gainingGoal: { text: draft.gainingGoal } },
    phases: [{ score: { gainingGoal: { text: draft.gainingGoal } } }],
  });
  const [, input] = ai.mock.calls[0] as unknown as [string, { messages: { content: string }[] }];
  const prompt = JSON.parse(input.messages[1].content);
  expect(prompt.question.text).toBe('問い合わせ対応をどう改善する？');
  expect(prompt.stocks).toHaveLength(1);
  expect(
    prompt.sources.some((source: { text: string }) => source.text.includes('来月末までに検証')),
  ).toBe(true);
  expect(saved.context.stocks?.[0].content).toContain('既存の窓口');
  expect((await create({ ...body, question_ids: ['q1'] })).status).toBe(200);
  expect((await create({ ...body, stock_ids: ['s2'] })).status).toBe(409);
  expect(ai).toHaveBeenCalledTimes(1);
  expect(await (await app.request('/api/v1/pufus')).json()).toMatchObject({
    pufus: [{ id, task: draft.gainingGoal, first_phase_task: draft.gainingGoal }],
  });
});

it('問いだけの選択で関連ストック本文も自動参照し、入力済みの目標を保持する', async () => {
  const response = await create({ task: '入力した目標', question_ids: ['q1'] });
  expect(response.status).toBe(202);
  const { id } = (await response.json()) as { id: string };
  const manualDraft = {
    winCondition: draft.winCondition,
    purposes: draft.purposes,
    elements: draft.elements,
  };
  app.env.AI = { run: vi.fn(async () => ({ response: JSON.stringify(manualDraft) })) };
  await run(id);
  expect(await get(id)).toMatchObject({
    task: '入力した目標',
    stock_ids: ['s1'],
    score: { gainingGoal: { text: '入力した目標' } },
    context: { stocks: [{ content: expect.stringContaining('来月末') }] },
  });
});

it('問いからの作成は目標未入力でも、その問いと関連ストックを引き継ぐ', async () => {
  const response = await create({}, '/api/v1/questions/q1/pufus');
  expect(response.status).toBe(202);
  const { id } = (await response.json()) as { id: string };
  await run(id);
  expect(await get(id)).toMatchObject({ status: 'ready', question_ids: ['q1'], stock_ids: ['s1'] });
  expect((await get(id)).score?.gainingGoal.text).not.toBe('');
});

it('参照なしで目標も空なら拒否し、ストックだけからは作成できる', async () => {
  expect((await create({ task: '  ' })).status).toBe(400);
  expect((await create({ stock_ids: ['s2'] })).status).toBe(202);
});

it.each(['foreign', 'pending', 'missing'])(
  '利用できない問い %s を拒否してジョブを作らない',
  async (id) => {
    expect((await create({ task: '目標', question_ids: [id] })).status).toBe(404);
    expect((await app.env.DB.prepare('SELECT id FROM pufu_scores').all()).results).toEqual([]);
    expect(
      (await app.env.DB.prepare("SELECT id FROM processing_jobs WHERE kind='pufu'").all()).results,
    ).toEqual([]);
  },
);

it('別プロジェクトのストックを拒否する', async () => {
  await app.env.DB.prepare(
    "INSERT INTO projects(id,user_id,name) VALUES ('other','alice','別')",
  ).run();
  await app.env.DB.prepare("UPDATE stocks SET project_id='other' WHERE id='s2'").run();
  expect((await create({ task: '目標', stock_ids: ['s2'] })).status).toBe(404);
});

it('長い本文でも保存容量を制限し、末尾を保持する', () => {
  const snapshot = snapshotStocks([
    {
      id: 's',
      title: '記事',
      note: 'メモ',
      summary: null,
      content: '冒頭。' + '長'.repeat(120000) + '最後の条件。',
    },
  ]);
  expect(JSON.stringify(snapshot).length).toBeLessThanOrEqual(128000);
  expect(snapshot[0].content?.includes('冒頭。')).toBe(true);
  expect(snapshot[0].content?.includes('最後の条件。')).toBe(true);
});

it.each([
  { task: '', label: '推測' },
  { task: '目'.repeat(1000), label: '入力済み' },
])('$label の目標と長い参照でもAI入力上限を守り明示条件を保持する', async ({ task }) => {
  const ai = vi.fn(async () => ({ response: JSON.stringify(draft) }));
  app.env.AI = { run: ai };
  const memory = {
    id: 'memory',
    revision: 1,
    text: '',
    updated_at: '',
    data: {
      interests: Array(8).fill('関'.repeat(300)),
      knowledge: Array.from({ length: 12 }, () => ({
        text: '知'.repeat(500),
        articleIds: Array(20).fill('article'),
      })),
      questions: Array(6).fill('論'.repeat(300)),
    },
  };
  const context: PufuContext = {
    task,
    details: '補'.repeat(4000),
    question: null,
    questions: Array.from({ length: 1 }, (_, i) => ({
      id: `q${i}`,
      text: '問'.repeat(500),
      source: 'user',
    })),
    stock: null,
    stocks: Array.from({ length: 1 }, (_, i) => ({
      id: `s${i}`,
      title: '資料',
      note: 'メ'.repeat(2000),
      summary: null,
      content: '本'.repeat(20000),
    })),
    project: { id: 'project', name: '計画', description: '背'.repeat(2000) },
    userMemory: memory,
    projectMemory: memory,
  };
  if (task)
    ai.mockResolvedValue({
      response: JSON.stringify({
        winCondition: draft.winCondition,
        purposes: draft.purposes,
        elements: draft.elements,
      }),
    });
  await generatePufu(app.env, context);
  const [, input] = ai.mock.calls[0] as unknown as [string, { messages: { content: string }[] }];
  expect(
    input.messages.reduce(
      (size, message) => size + new TextEncoder().encode(message.content).length,
      0,
    ),
  ).toBeLessThanOrEqual(24000);
  const prompt = JSON.parse(input.messages[1].content);
  expect(prompt.task).toBe(task);
  expect(prompt.details).toBe(context.details);
  expect(prompt.question.text).toBe('問'.repeat(500));
  expect(prompt.stocks).toHaveLength(1);
  expect(
    prompt.sources.some(
      (source: { kind: string; text: string }) => source.kind === 'article' && Boolean(source.text),
    ),
  ).toBe(true);
});

it('本文取得中に参照が削除されたら受付を取り消し、利用枠を消費しない', async () => {
  const original = app.env.CONTENT;
  app.env.CONTENT = new Proxy(original, {
    get(target, key) {
      if (key === 'get')
        return async (id: string) => {
          const object = await target.get(id);
          await app.env.DB.prepare("DELETE FROM stocks WHERE id='s1'").run();
          return object;
        };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const response = await create({ stock_ids: ['s1'] });
  expect(response.status).toBe(409);
  expect((await app.env.DB.prepare('SELECT id FROM pufu_scores').all()).results).toEqual([]);
  expect(
    (await app.env.DB.prepare("SELECT id FROM ai_operations WHERE kind='pufu'").all()).results,
  ).toEqual([]);
});

it('問いの関連ストックが大量にあっても2件だけ確認し、明示選択を求める', async () => {
  await app.env.DB.batch(
    Array.from({ length: 102 }, (_, i) => `extra-${i}`).flatMap((id) => [
      app.env.DB.prepare(
        "INSERT INTO articles(id,user_id,canonical_url,source_url,title,domain,input_text) VALUES (?,'alice',?,'','記事','',?)",
      ).bind(id, id, '本'.repeat(20000)),
      app.env.DB.prepare(
        "INSERT INTO stocks(id,user_id,project_id,article_id) VALUES (?,'alice','alice-project',?)",
      ).bind(id, id),
      app.env.DB.prepare("INSERT INTO question_stocks(question_id,stock_id) VALUES ('q1',?)").bind(
        id,
      ),
    ]),
  );
  const batch = app.env.DB.batch.bind(app.env.DB);
  let bodyRows = 0;
  app.env.DB = new Proxy(app.env.DB, {
    get(target, key) {
      if (key === 'batch')
        return async (statements: D1PreparedStatement[]) => {
          const results = await batch(statements);
          for (const result of results) {
            if (result.results.some((row) => row && typeof row === 'object' && 'input_text' in row))
              bodyRows = result.results.length;
          }
          return results;
        };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  expect((await create({ question_ids: ['q1'] })).status).toBe(400);
  expect(bodyRows).toBe(2);
  expect(bodyRows).toBeGreaterThan(0);
});

it('根拠の一致する施策だけを採用し、記事の事例と入力条件を区別する', async () => {
  const context: PufuContext = {
    task: '修復の判断基準を整理する',
    details: '担当は2名。まず資料を整理する。',
    question: null,
    stock: {
      id: 's',
      title: '修復の事例',
      note: '',
      summary: null,
      content: 'この事例では監督とサンプルを確認する。90分作品の修復に3か月を要した。',
    },
    project: { id: 'p', name: '検討', description: '' },
    userMemory: null,
    projectMemory: null,
  };
  const ai = vi.fn(async (_model: string, input: { messages: { content: string }[] }) => {
    const data = JSON.parse(input.messages[1].content);
    const article = data.sources?.find((s: { kind: string }) => s.kind === 'article');
    return {
      response: JSON.stringify({
        winCondition: '判断に必要な条件が分かっている。',
        purposes: [
          {
            text: '判断基準が整理されている。',
            measures: [
              {
                sourceId: article?.id ?? 'article:0:0',
                quote: 'この事例では監督とサンプルを確認する。',
                color: 'white',
              },
              {
                sourceId: article?.id ?? 'article:0:0',
                quote: '国際協力のワークショップを開催する。',
                color: 'white',
              },
              { sourceId: 'missing', quote: 'まず資料を整理する。', color: 'white' },
            ],
          },
        ],
        elements: Object.fromEntries(
          elementKeys.map((key) => [
            key,
            key === 'people'
              ? { sourceId: 'details', quote: '担当は2名。' }
              : key === 'time'
                ? {
                    sourceId: article?.id ?? 'article:0:0',
                    quote: '90分作品の修復に3か月を要した。',
                  }
                : null,
          ]),
        ),
      }),
    };
  });
  app.env.AI = { run: ai };
  const result = await generatePufu(app.env, context);
  expect(result.purposes[0].measures).toHaveLength(1);
  expect(result.purposes[0].measures[0].text).toContain('参考事例');
  expect(result.purposes[0].measures[0].comment.text).toContain('実行予定');
  expect(result.elements.people.text).toBe('担当は2名。');
  expect(result.elements.time.text).toContain('参考事例');
  expect(result.elements.time.comment.text).toContain('自分の条件');
  expect(result.elements.foreignEnemy.text).toBe('未確認');
  expect(result.gainingGoal.text).toBe(context.task);
  expect(result.gainingGoal.comment.text).toContain('入力');
  expect(ai).toHaveBeenCalledTimes(1);
});

it('目標だけの入力でも施策を補完せず、空の施策を保存できる', async () => {
  const ai = vi.fn(async () => ({
    response: JSON.stringify({
      gainingGoal: '判断基準を整理する資料',
      winCondition: '判断の理由を説明できる。',
      purposes: [{ text: '必要な条件が分かる。', measures: [] }],
      elements: Object.fromEntries(elementKeys.map((key) => [key, null])),
    }),
  }));
  app.env.AI = { run: ai };
  const result = await generatePufu(app.env, {
    task: '',
    question: { id: 'q', source: 'user', text: '何を基準に修復する？' },
    stock: null,
    project: { id: 'p', name: '検討', description: '' },
    userMemory: null,
    projectMemory: null,
  });
  expect(result.gainingGoal.text).toMatch(/^仮説：/);
  expect(result.purposes[0].measures).toEqual([]);
  expect(result.winCondition.comment.text).toContain('仮説');
});

it('長い本文の中間・末尾と取得不足を保持し、AI入力は上限内に収める', async () => {
  const body =
    '冒頭の判断。' +
    'あ'.repeat(35000) +
    '中間だけの条件。' +
    'い'.repeat(35000) +
    '末尾だけの品質条件。';
  await app.env.CONTENT.put('body-one', body, {
    customMetadata: { complete: 'false', pages: '["https://example.com/a"]' },
  });
  const response = await create({ stock_ids: ['s1'] });
  const { id } = (await response.json()) as { id: string };
  const saved = await get(id);
  expect(saved.context.stocks?.[0].content).toContain('中間だけの条件');
  expect(saved.context.stocks?.[0].content).toContain('末尾だけの品質条件');
  expect(saved.context.stocks?.[0].contentIncomplete).toBe(true);
  const ai = vi.fn(async () => ({
    response: JSON.stringify({
      gainingGoal: '仮説：資料',
      winCondition: '判断できる',
      purposes: [],
      elements: Object.fromEntries(elementKeys.map((key) => [key, null])),
    }),
  }));
  app.env.AI = { run: ai };
  const score = await generatePufu(app.env, saved.context);
  const input = ai.mock.calls[0] as unknown as [string, { messages: { content: string }[] }];
  const data = JSON.parse(input[1].messages[1].content);
  const content = data.sources
    .filter((s: { kind: string }) => s.kind === 'article')
    .map((s: { text: string }) => s.text)
    .join('');
  expect(content).toContain('中間だけの条件');
  expect(content).toContain('末尾だけの品質条件');
  expect(
    input[1].messages.reduce((n, m) => n + new TextEncoder().encode(m.content).length, 0),
  ).toBeLessThanOrEqual(24000);
  expect(score.gainingGoal.comment.text).toContain('一部');
});

it('抜粋の間をつないだ引用と、要約だけを根拠にした施策を採用しない', async () => {
  const makeDraft = (sourceId: string, quote: string) => ({
    winCondition: '根拠が分かる。',
    purposes: [{ text: '条件が整理されている。', measures: [{ sourceId, quote, color: 'white' }] }],
    elements: Object.fromEntries(elementKeys.map((key) => [key, { sourceId, quote }])),
  });
  const context: PufuContext = {
    task: '判断基準を整理する。',
    question: null,
    project: { id: 'p', name: '計画', description: '' },
    userMemory: null,
    projectMemory: null,
    stock: {
      id: 's',
      title: '事例',
      note: '',
      summary: null,
      content:
        '先頭の記述。' +
        Array.from({ length: 40000 }, (_, i) => String.fromCharCode(0x1000 + i)).join('') +
        '末尾の記述。',
    },
  };
  app.env.AI = {
    run: async (_model, input) => {
      const data = JSON.parse(input.messages[1].content);
      const sources = data.sources.filter((s: { kind: string }) => s.kind === 'article');
      const quote = sources[0].text.slice(-5) + sources[1].text.slice(0, 5);
      return { response: JSON.stringify(makeDraft(sources[0].id, quote)) };
    },
  };
  const excerpts = await generatePufu(app.env, context);
  expect(excerpts.purposes[0].measures).toEqual([]);
  expect(excerpts.elements.money.text).toBe('未確認');
  context.stock!.content = null;
  context.stock!.summary = { overview: 'ワークショップを開催する。', keyPoints: [], topics: [] };
  app.env.AI = {
    run: async () => ({
      response: JSON.stringify(makeDraft('summary:0', 'ワークショップを開催する。')),
    }),
  };
  const summary = await generatePufu(app.env, context);
  expect(summary.purposes[0].measures).toEqual([]);
  expect(summary.elements.money.text).toBe('未確認');
});

it('各入力が上限でも本文の参照枠を確保し、先頭・中間・末尾を送る', async () => {
  const body =
    '最初の条件。' + '甲'.repeat(60000) + '真ん中の条件。' + '乙'.repeat(60000) + '最後の条件。';
  const stocks = snapshotStocks([
    { id: 's', title: '題'.repeat(200), note: 'メ'.repeat(2000), summary: null, content: body },
  ]);
  const ai = vi.fn(async () => ({
    response: JSON.stringify({
      winCondition: '状況が分かる',
      purposes: [],
      elements: Object.fromEntries(elementKeys.map((key) => [key, null])),
    }),
  }));
  app.env.AI = { run: ai };
  const score = await generatePufu(app.env, {
    task: '目'.repeat(1000),
    details: '補'.repeat(4000),
    question: { id: 'q', source: 'user', text: '問'.repeat(500) },
    stocks,
    stock: stocks[0],
    project: { id: 'p', name: '名'.repeat(80), description: '背'.repeat(2000) },
    userMemory: null,
    projectMemory: null,
  });
  const [, input] = ai.mock.calls[0] as unknown as [string, { messages: { content: string }[] }];
  const sources = JSON.parse(input.messages[1].content).sources as { kind: string; text: string }[];
  const article = sources
    .filter((s) => s.kind === 'article')
    .map((s) => s.text)
    .join('');
  expect(article.includes('最初の条件。')).toBe(true);
  expect(article.includes('真ん中の条件。')).toBe(true);
  expect(article.includes('最後の条件。')).toBe(true);
  expect(score.gainingGoal.text).toBe('目'.repeat(1000));
  expect(
    input.messages.reduce((n, m) => n + new TextEncoder().encode(m.content).length, 0),
  ).toBeLessThanOrEqual(24000);
});

it('否定や条件を切り落とした部分引用を施策にしない', async () => {
  app.env.AI = {
    run: async () => ({
      response: JSON.stringify({
        winCondition: '状況が分かる。',
        purposes: [
          {
            text: '条件が整理されている。',
            measures: [
              { sourceId: 'article:0:0', quote: 'ワークショップを開催する', color: 'white' },
            ],
          },
        ],
        elements: Object.fromEntries(elementKeys.map((key) => [key, null])),
      }),
    }),
  };
  const result = await generatePufu(app.env, {
    task: '記事の条件を整理する。',
    question: null,
    project: { id: 'p', name: '検討', description: '' },
    userMemory: null,
    projectMemory: null,
    stock: {
      id: 's',
      title: '事例',
      note: '',
      summary: null,
      content: 'ワークショップを開催する予定はない。',
    },
  });
  expect(result.purposes[0].measures).toEqual([]);
});

it.each(['article', 'note'])('抜粋の%sの切断端を完全な文とみなして引用しない', (kind) => {
  const body = 'ワークショップを開催する予定はない。'.repeat(1000);
  let probe:
    { input: ReturnType<typeof generationInput>; sourceId: string; quote: string } | undefined;
  for (let budget = 1800; budget < 1850; budget++) {
    const input = generationInput(
      {
        task: '整理する。',
        question: null,
        project: { id: 'p', name: '計画', description: '' },
        userMemory: null,
        projectMemory: null,
        stock: {
          id: 's',
          title: '事例',
          note: kind === 'note' ? body : '',
          summary: null,
          content: kind === 'article' ? body : null,
        },
      },
      budget,
    );
    const source = input.sources.find((s) => s.kind === kind)!;
    const quote = Array.from(
      new Intl.Segmenter('ja', { granularity: 'sentence' }).segment(source.text),
    )
      .at(-1)!
      .segment.trim();
    if (quote !== 'ワークショップを開催する予定はない。') {
      probe = { input, sourceId: source.id, quote };
      break;
    }
  }
  expect(probe).toBeDefined();
  expect(resolveQuote({ sourceId: probe!.sourceId, quote: probe!.quote }, probe!.input)).toBeNull();
});
