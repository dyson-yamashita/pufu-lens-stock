import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { testApp, mockStep } from './helpers';
import { mockPufuAi, reviewDraft } from './pufu-ai-fixture';
import { runPufu } from '../server/pufu';
import type { Job } from '../server/env';
import type { Pufu } from '../shared/pufu';

let app: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  app = await testApp();
});
afterEach(async () => {
  await app.dispose();
  vi.restoreAllMocks();
});
const draft = {
  winCondition: '窓口の担当者が結果を説明できる。',
  purposes: [
    {
      text: '試験運用の結果が得られている。',
      measures: [{ text: '既存の窓口で試験運用する。', color: 'white' }],
    },
  ],
  elements: {
    people: '担当は2名。',
    money: '',
    time: '',
    quality: '',
    businessScheme: '',
    environment: '',
    rival: '',
    foreignEnemy: '',
  },
};
async function create(details = '担当は2名。既存の窓口で試験運用する。') {
  const response = await app.request('/api/v1/projects/alice-project/pufus/generate', {
    method: 'POST',
    body: {
      task: '窓口の手順書',
      details,
      request_id: crypto.randomUUID(),
    },
  });
  expect(response.status).toBe(202);
  const { id } = (await response.json()) as { id: string };
  return (await app.env.DB.prepare(
    "SELECT * FROM processing_jobs WHERE kind='pufu' AND target_id=?",
  )
    .bind(id)
    .first<Job>())!;
}
const get = async (id: string) =>
  ((await (await app.request(`/api/v1/pufus/${id}`)).json()) as { pufu: Pufu }).pufu;

it('検証失敗を試行ごとに記録し、内容を漏らさず再試行後に完了する', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const ai = mockPufuAi(draft);
  const valid = ai.getMockImplementation()!;
  let extraction = 0;
  ai.mockImplementation(async (...args) => {
    const response = await valid(...args);
    const value = JSON.parse((response as { response: string }).response);
    if ('actions' in value && ++extraction <= 2) {
      value.cases = {
        materials: [
          {
            evidence: extraction === 1 ? 'E999' : 'E1',
            subject: '非公開の対象名',
            text: 'AIが返した非公開の説明文',
            kind: 'actual',
          },
        ],
        decisions: [],
        processing: [],
      };
      return { response: JSON.stringify(value) };
    }
    return response;
  });
  const job = await create('非公開の資料本文。担当は2名。既存の窓口で試験運用する。');
  app.env.AI = { run: ai };
  const step = mockStep();
  const run = step.do.bind(step);
  step.do = (async (name: string, config: unknown, operation?: () => Promise<unknown>) => {
    if (name !== 'extract-pufu-facts-v3')
      return (run as (...args: unknown[]) => Promise<unknown>)(name, config, operation);
    await expect(operation!()).rejects.toThrow('evidence_not_found');
    await expect(operation!()).rejects.toThrow('subject_not_in_evidence');
    return operation!();
  }) as typeof step.do;
  await runPufu(app.env, job, step);
  expect(log.mock.calls).toEqual([
    [
      'pufu_fact_validation_failed',
      {
        jobId: job.id,
        stage: 'extract-pufu-facts-v3',
        attempt: 1,
        maxAttempts: 10,
        reason: 'evidence_not_found',
        path: 'cases.materials[0]',
        evidence: 'E999',
      },
    ],
    [
      'pufu_fact_validation_failed',
      {
        jobId: job.id,
        stage: 'extract-pufu-facts-v3',
        attempt: 2,
        maxAttempts: 10,
        reason: 'subject_not_in_evidence',
        path: 'cases.materials[0]',
        evidence: 'E1',
      },
    ],
  ]);
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/非公開|AIが返した/);
  expect(await get(job.target_id)).toMatchObject({ status: 'ready', generation_progress: null });
  expect(
    await app.env.DB.prepare('SELECT status,attempts FROM ai_calls WHERE id=?')
      .bind(`${job.id}:extract-pufu-facts-v3`)
      .first(),
  ).toMatchObject({ status: 'done', attempts: 3 });
});

it('詳細APIは現在の世代の処理段階と再試行を返し、完了後は進捗を返さない', async () => {
  const ai = mockPufuAi(draft);
  const valid = ai.getMockImplementation()!;
  const job = await create();
  expect(await get(job.target_id)).toMatchObject({ status: 'queued', generation_progress: null });
  const stages = ['extract', 'extract', 'arrange', 'integrate', 'review'];
  let call = 0;
  ai.mockImplementation(async (...args) => {
    const index = call++;
    expect(await get(job.target_id)).toMatchObject({
      status: 'generating',
      generation_progress: {
        stage: stages[index],
        attempt: index === 1 ? 2 : 1,
        status: 'running',
      },
    });
    return index === 0 ? { response: '{}' } : valid(...args);
  });
  app.env.AI = { run: ai };
  // Workflowの自動再試行を1回だけ再現し、試行の合間もAPIから観測する。
  const step = mockStep();
  const run = step.do.bind(step);
  step.do = (async (
    name: string,
    configOrOperation: unknown,
    operation?: () => Promise<unknown>,
  ) => {
    if (name !== 'extract-pufu-facts-v3')
      return (run as (...args: unknown[]) => Promise<unknown>)(name, configOrOperation, operation);
    await expect(operation!()).rejects.toThrow('出力形式');
    expect(await get(job.target_id)).toMatchObject({
      status: 'generating',
      generation_progress: { stage: 'extract', attempt: 1, status: 'failed' },
    });
    return operation!();
  }) as typeof step.do;
  await runPufu(app.env, job, step);
  expect(call).toBe(5);
  expect(await get(job.target_id)).toMatchObject({ status: 'ready', generation_progress: null });
  // 生成のやり直しで、前の世代のAI呼び出しを現在の進捗に使わない。
  await app.env.DB.prepare(
    "UPDATE pufu_scores SET generation=generation+1,status='generating' WHERE id=?",
  )
    .bind(job.target_id)
    .run();
  expect(await get(job.target_id)).toMatchObject({
    status: 'generating',
    generation_progress: null,
  });
});

it('抽出と構成を別々に計数し、完成したプ譜だけを保存する', async () => {
  const ai = mockPufuAi(draft);
  app.env.AI = { run: ai };
  const job = await create();
  await runPufu(app.env, job, mockStep());
  expect(ai).toHaveBeenCalledTimes(4);
  expect(
    (await app.env.DB.prepare('SELECT id,status,attempts FROM ai_calls ORDER BY id').all()).results,
  ).toEqual([
    { id: `${job.id}:arrange-pufu-v4`, status: 'done', attempts: 1 },
    { id: `${job.id}:extract-pufu-facts-v3`, status: 'done', attempts: 1 },
    { id: `${job.id}:integrate-pufu-win-v4`, status: 'done', attempts: 1 },
    { id: `${job.id}:review-pufu-win-v3`, status: 'done', attempts: 1 },
  ]);
  expect(await app.env.DB.prepare('SELECT COUNT(*) AS n FROM ai_attempts').first()).toEqual({
    n: 4,
  });
  expect((await get(job.target_id)).status).toBe('ready');
});

it('DeepSeekで全段階を生成し、保存するモデル名を重複させない', async () => {
  const ai = mockPufuAi(draft);
  const original = ai.getMockImplementation()!;
  ai.mockImplementation(async (...args) => {
    const answer = (await original(...args)) as { response: string };
    return { choices: [{ finish_reason: 'stop', message: { content: answer.response } }] };
  });
  app.env.AI = { run: ai };
  const model = '@cf/deepseek-ai/deepseek-v4.1-flash-1017';
  app.env.AI_PUFU_MODEL = model;
  app.env.AI_PUFU_PLAN_MODEL = model;
  const job = await create();
  // #185より前と#185の両形式。旧モデルの成功キャッシュを新モデル名で保存しない。
  const oldStages = [
    'extract-pufu-facts-v1',
    'arrange-pufu-v2',
    'integrate-pufu-win-v2',
    'review-pufu-win-v1',
    'extract-pufu-facts-v2',
    'arrange-pufu-v3',
    'integrate-pufu-win-v3',
    'review-pufu-win-v2',
  ];
  for (const name of oldStages)
    await app.env.DB.prepare(
      "INSERT INTO ai_calls(id,job_id,user_id,status,result_json) VALUES (?,?,'alice','done',?)",
    )
      .bind(`${job.id}:${name}`, job.id, JSON.stringify({ value: {} }))
      .run();
  const step = mockStep();
  const originalStep = step.do.bind(step);
  const legacyWorkflowCache = vi.fn(() => ({ retryAt: null, json: '{"value":{}}' }));
  step.do = (async (name: string, ...args: unknown[]) =>
    oldStages.includes(name)
      ? legacyWorkflowCache()
      : (originalStep as (...args: unknown[]) => Promise<unknown>)(
          name,
          ...args,
        )) as typeof step.do;
  await runPufu(app.env, job, step);
  expect(legacyWorkflowCache).not.toHaveBeenCalled();
  expect(ai.mock.calls.map(([name]) => name)).toEqual([model, model, model, model]);
  for (const [, input] of ai.mock.calls) expect(input).toMatchObject({ reasoning_effort: 'none' });
  expect(await get(job.target_id)).toMatchObject({ status: 'ready', model });
});

it('本文抽出と短い構成に別モデルを使い、両モデルを保存する', async () => {
  const ai = mockPufuAi(draft);
  app.env.AI = { run: ai };
  app.env.AI_PUFU_MODEL = '@cf/zai-org/glm-5.3-flash';
  app.env.AI_PUFU_PLAN_MODEL = '@cf/moonshotai/kimi-k2.6';
  const job = await create();
  await runPufu(app.env, job, mockStep());
  expect(ai.mock.calls.map(([model]) => model)).toEqual([
    '@cf/zai-org/glm-5.3-flash',
    '@cf/moonshotai/kimi-k2.6',
    '@cf/moonshotai/kimi-k2.6',
    '@cf/moonshotai/kimi-k2.6',
  ]);
  expect(ai.mock.calls[1][1]).toMatchObject({
    max_tokens: 2000,
    reasoning_effort: 'none',
    chat_template_kwargs: { enable_thinking: false },
    response_format: { json_schema: { name: 'pufu', strict: true } },
  });
  expect((await get(job.target_id)).model).toBe(
    '@cf/zai-org/glm-5.3-flash + @cf/moonshotai/kimi-k2.6',
  );
});

it('保存前の再整形でも、購入制約に併記された既存道具の条件を保持する', async () => {
  await app.request('/api/v1/me', {
    method: 'PATCH',
    body: { name: 'Alice', bio: '', language: 'en' },
  });
  app.env.AI = {
    run: mockPufuAi({
      ...draft,
      winCondition: 'The team can use the inspection results.',
      purposes: [
        {
          text: 'Inspection results are available.',
          measures: [{ text: 'Inspect the equipment.', color: 'white' }],
        },
      ],
      elements: {
        ...draft.elements,
        people: 'One technician.',
        money: 'No additional purchases; use existing tools.',
      },
    }),
  };
  const job = await create('One technician. Use existing tools. No additional purchases.');
  await runPufu(app.env, job, mockStep());
  const saved = (await get(job.target_id)).score!;
  expect(saved.elements.money.text).toContain('No additional purchases');
  expect(saved.elements.money.text).toContain('use existing tools');
});

it.each([1, 2, 3])(
  '利用上限%d回で未完成を保存せず、成功した段階を再送せずに再開する',
  async (limit) => {
    const ai = mockPufuAi(draft);
    app.env.AI = { run: ai };
    app.env.AI_CALL_DAILY_LIMIT = String(limit);
    const job = await create();
    await runPufu(app.env, job, mockStep());
    expect(ai).toHaveBeenCalledTimes(limit);
    expect(await get(job.target_id)).toMatchObject({ status: 'queued', score: null });
    expect(
      (
        await app.env.DB.prepare('SELECT * FROM pufu_phases WHERE pufu_id=?')
          .bind(job.target_id)
          .all()
      ).results,
    ).toEqual([]);
    app.env.AI_CALL_DAILY_LIMIT = '4';
    await runPufu(app.env, job, mockStep());
    expect(ai).toHaveBeenCalledTimes(4);
    expect(await get(job.target_id)).toMatchObject({
      status: 'ready',
      score: { elements: { people: { text: '担当は2名。' } } },
    });
  },
);

it('構成が不正なら抽出のキャッシュから再開し、二重送信しない', async () => {
  const ai = mockPufuAi(draft);
  const valid = ai.getMockImplementation()!;
  let calls = 0;
  ai.mockImplementation(async (...args) => (++calls === 2 ? { response: '{}' } : valid(...args)));
  app.env.AI = { run: ai };
  const job = await create();
  await expect(runPufu(app.env, job, mockStep())).rejects.toThrow('出力形式');
  await app.env.DB.prepare("UPDATE pufu_scores SET status='queued' WHERE id=?")
    .bind(job.target_id)
    .run();
  await app.env.DB.prepare("UPDATE processing_jobs SET status='pending' WHERE id=?")
    .bind(job.id)
    .run();
  await runPufu(app.env, job, mockStep());
  expect(ai).toHaveBeenCalledTimes(5);
  expect((await get(job.target_id)).status).toBe('ready');
  expect(await app.env.DB.prepare('SELECT COUNT(*) AS n FROM ai_attempts').first()).toEqual({
    n: 5,
  });
});

it.each(['delete', 'generation', 'privacy'] as const)(
  '抽出後の%s変更があれば構成AIを呼ばず保存しない',
  async (change) => {
    const ai = mockPufuAi(draft);
    app.env.AI = { run: ai };
    const job = await create();
    const step = mockStep();
    const original = step.do.bind(step);
    step.do = (async (name: string, ...args: unknown[]) => {
      const result = await (original as (...args: unknown[]) => Promise<unknown>)(name, ...args);
      if (name === 'extract-pufu-facts-v3') {
        if (change === 'delete')
          expect(
            (await app.request(`/api/v1/pufus/${job.target_id}`, { method: 'DELETE' })).status,
          ).toBe(200);
        else if (change === 'generation')
          await app.env.DB.prepare('UPDATE pufu_scores SET generation=generation+1 WHERE id=?')
            .bind(job.target_id)
            .run();
        else
          await app.env.DB.prepare("INSERT INTO privacy_cleanup_jobs(id,kind) VALUES (?,'pufu')")
            .bind(job.id)
            .run();
      }
      return result;
    }) as typeof step.do;
    await runPufu(app.env, job, step);
    expect(ai).toHaveBeenCalledTimes(1);
    expect(
      (
        await app.env.DB.prepare('SELECT * FROM pufu_phases WHERE pufu_id=?')
          .bind(job.target_id)
          .all()
      ).results,
    ).toEqual([]);
  },
);

it('勝利条件の統合が不正なら中間目的のキャッシュから再開する', async () => {
  const ai = mockPufuAi(draft);
  const valid = ai.getMockImplementation()!;
  let calls = 0;
  ai.mockImplementation(async (...args) => (++calls === 3 ? { response: '{}' } : valid(...args)));
  app.env.AI = { run: ai };
  const job = await create();
  await expect(runPufu(app.env, job, mockStep())).rejects.toThrow('出力形式');
  expect((await get(job.target_id)).score).toBeNull();
  await app.env.DB.prepare("UPDATE pufu_scores SET status='queued' WHERE id=?")
    .bind(job.target_id)
    .run();
  await app.env.DB.prepare("UPDATE processing_jobs SET status='pending' WHERE id=?")
    .bind(job.id)
    .run();
  await runPufu(app.env, job, mockStep());
  expect(ai).toHaveBeenCalledTimes(5);
  expect((await get(job.target_id)).status).toBe('ready');
  const prompts = ai.mock.calls.map(([, input]) => JSON.parse(input.messages[1].content));
  expect(prompts.filter((p) => 'sources' in p)).toHaveLength(1);
  expect(prompts.filter((p) => 'actionGroups' in p)).toHaveLength(1);
});

it.each([4, 5])('意味の修正中に上限%d回へ達しても、完了段階を再送しない', async (limit) => {
  const ai = mockPufuAi(draft);
  const base = ai.getMockImplementation()!;
  let reviews = 0;
  ai.mockImplementation(async (model, input) => {
    const data = JSON.parse(input.messages[1].content);
    if ('winCondition' in data && reviews++ === 0)
      return { response: JSON.stringify(reviewDraft(data, ['全目的の成果を結び付ける。'])) };
    return base(model, input);
  });
  app.env.AI = { run: ai };
  app.env.AI_CALL_DAILY_LIMIT = String(limit);
  const job = await create();
  await runPufu(app.env, job, mockStep());
  expect(ai).toHaveBeenCalledTimes(limit);
  expect(await get(job.target_id)).toMatchObject({ status: 'queued', score: null });
  app.env.AI_CALL_DAILY_LIMIT = '6';
  await runPufu(app.env, job, mockStep());
  expect(ai).toHaveBeenCalledTimes(6);
  expect((await get(job.target_id)).status).toBe('ready');
});

it('意味の再検証も不合格なら未完成を保存せず、同じ世代で生成を増やさない', async () => {
  const ai = mockPufuAi(draft, ['全体の成就を表していない。']);
  app.env.AI = { run: ai };
  const job = await create();
  await expect(runPufu(app.env, job, mockStep())).rejects.toThrow('勝利条件');
  expect(await get(job.target_id)).toMatchObject({ status: 'failed', score: null });
  expect(
    (
      await app.env.DB.prepare('SELECT * FROM pufu_phases WHERE pufu_id=?')
        .bind(job.target_id)
        .all()
    ).results,
  ).toEqual([]);
  await app.env.DB.prepare("UPDATE pufu_scores SET status='queued' WHERE id=?")
    .bind(job.target_id)
    .run();
  await expect(runPufu(app.env, job, mockStep())).rejects.toThrow('勝利条件');
  expect(ai).toHaveBeenCalledTimes(6);
});

it('別の文を検証したキャッシュで保存しない', async () => {
  app.env.AI = { run: mockPufuAi(draft) };
  const job = await create();
  const step = mockStep();
  const base = step.do.bind(step);
  step.do = (async (name: string, ...args: unknown[]) =>
    name === 'review-pufu-win-v3'
      ? {
          retryAt: null,
          json: JSON.stringify({ value: { winCondition: '別の勝利条件。', issues: [] } }),
        }
      : (base as (...args: unknown[]) => Promise<unknown>)(name, ...args)) as typeof step.do;
  await expect(runPufu(app.env, job, step)).rejects.toThrow('検証');
  expect((await get(job.target_id)).score).toBeNull();
});
