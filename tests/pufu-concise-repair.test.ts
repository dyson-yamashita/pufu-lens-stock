import { expect, it } from 'vitest';
import { generatePufu, runPufu } from '../server/pufu';
import type { Env, Job } from '../server/env';
import type { PufuContext } from '../shared/pufu';
import { mockPufuAi } from './pufu-ai-fixture';
import { testApp, mockStep } from './helpers';

const context: PufuContext = {
  task: '資料の保存版',
  details: '資料を保存する。購入はしない。',
  question: null,
  stock: null,
  project: { id: 'p', name: '保存', description: '' },
  userMemory: null,
  projectMemory: null,
};
const draft = {
  winCondition: '担当者が保存した資料を参照できる。',
  purposes: [
    { text: '資料が保存されている。', measures: [{ text: '資料を保存する。', color: 'white' }] },
  ],
  elements: {},
};
const env = (run: NonNullable<Env['AI']>['run']) =>
  ({ AI: { run }, AI_MODEL: 'test' }) as unknown as Env;

it('引用が不一致でも正しい施策を保持し、該当する条件だけを修復する', async () => {
  const ai = mockPufuAi(draft);
  const base = ai.getMockImplementation()!;
  let extracted = 0;
  ai.mockImplementation(async (model, input) => {
    const data = JSON.parse(input.messages[1].content);
    if ('repairFacts' in data) {
      expect(Object.keys(data.repairFacts)).toEqual(['conditions[0]']);
      return {
        response: JSON.stringify({
          'conditions[0]': {
            evidence: 'E2',
            scope: 'project',
            element: 'money',
            text: '購入はしない。',
            quote: '購入はしない。',
          },
        }),
      };
    }
    const response = await base(model, input);
    if ('sources' in data) {
      extracted++;
      const value = JSON.parse((response as { response: string }).response);
      value.conditions = [
        {
          evidence: 'E2',
          scope: 'project',
          element: 'money',
          text: '購入はしない。',
          quote: '購入しない。',
        },
      ];
      return { response: JSON.stringify(value) };
    }
    return response;
  });
  const score = await generatePufu(env(ai), {
    ...context,
    details: '',
    stock: {
      id: 's',
      title: '保存の工程',
      note: '',
      summary: null,
      content: context.details,
    },
  });
  expect(score.purposes[0].measures[0].text).toBe('資料を保存する。');
  expect(score.elements.money.text).toBe('購入はしない。');
  expect(extracted).toBe(1);
});

const longCondition =
  '監修者に最初にサンプルを見せ、細かな確認を行って方針をすり合わせる。作業中に方針を変更すると手戻りが大きくなるため、アーカイブ担当者が作品ごとの作業基準を決める。限られた時間と依頼者の予算に合わせて実施範囲を調整し、再撮影は行わない。';
const shortCondition =
  '監修者と初期に方針を合意し、担当者が基準を決定。時間・予算内で範囲を調整し、再撮影はしない。';
function compactProvider(accepted: boolean) {
  const ai = mockPufuAi(draft);
  const base = ai.getMockImplementation()!;
  ai.mockImplementation(async (model, input) => {
    const data = JSON.parse(input.messages[1].content);
    if ('compactNodes' in data)
      return { response: JSON.stringify({ texts: { businessScheme: shortCondition } }) };
    if ('verifyCompaction' in data)
      return {
        response: JSON.stringify({
          checks: {
            businessScheme: {
              text: shortCondition,
              preserved: accepted,
              grounded: accepted,
              reason: accepted ? '主体・制約・否定を保持。' : '再撮影の禁止が欠落。',
            },
          },
        }),
      };
    const response = await base(model, input);
    if ('sources' in data) {
      const value = JSON.parse((response as { response: string }).response);
      value.conditions = [
        {
          evidence: 'E1',
          scope: 'project',
          element: 'businessScheme',
          text: '監修者に最初にサンプルを見せ、細かな確認を行って方針をすり合わせる。作業中に方針を変更すると手戻りが大きくなるため、アーカイブ担当者が作品ごとの作業基準を決める。',
          quote: '資料を保存する。',
        },
      ];
      value.elements.businessScheme = [
        {
          evidence: 'E1',
          scope: 'project',
          text: '限られた時間と依頼者の予算に合わせて実施範囲を調整し、再撮影は行わない。',
        },
      ];
      return { response: JSON.stringify(value) };
    }
    return response;
  });
  return ai;
}

it('長い八要素を独立検証した短文で保存し、後段で元の条件文を再追加しない', async () => {
  const ai = compactProvider(true);
  const score = await generatePufu(env(ai), {
    ...context,
    details: longCondition + '資料を保存する。',
  });
  expect(score.elements.businessScheme.text).toBe(shortCondition);
  expect(score.elements.businessScheme.text.length).toBeLessThanOrEqual(100);
});

it('モデル設定が変更されても抽出・短文化と構成・検証は現在の設定を参照する', async () => {
  const ai = compactProvider(true);
  const extraction = '@cf/deepseek-ai/deepseek-v4.1-flash-1017';
  const planning = '@cf/google/gemma-4-26b-a4b-it';
  const score = await generatePufu(
    { ...env(ai), AI_PUFU_MODEL: extraction, AI_PUFU_PLAN_MODEL: planning },
    { ...context, details: longCondition + '資料を保存する。' },
  );
  expect(score.elements.businessScheme.text).toBe(shortCondition);
  expect(ai.mock.calls.map(([model]) => model)).toEqual([
    extraction,
    planning,
    extraction,
    planning,
    planning,
    planning,
  ]);
  expect(ai.mock.calls.every(([, input]) => input.temperature === 0)).toBe(true);
});

it('修正後も意味検証で拒否された短文は採用せず元の記述を保持する', async () => {
  const score = await generatePufu(env(compactProvider(false)), {
    ...context,
    details: longCondition + '資料を保存する。',
  });
  expect(score.elements.businessScheme.text).toBe(
    '監修者に最初にサンプルを見せ、細かな確認を行って方針をすり合わせる。作業中に方針を変更すると手戻りが大きくなるため、アーカイブ担当者が作品ごとの作業基準を決める。 限られた時間と依頼者の予算に合わせて実施範囲を調整し、再撮影は行わない。',
  );
  expect(score.elements.businessScheme.text).not.toBe(shortCondition);
});

it('字数超過と意味の指摘を両方渡して1回だけ修正し、再検証した短文を返す', async () => {
  const ai = compactProvider(true);
  const base = ai.getMockImplementation()!;
  const rejected = '方針を決める。'.repeat(20);
  let checks = 0;
  ai.mockImplementation(async (model, input) => {
    const data = JSON.parse(input.messages[1].content);
    if ('compactNodes' in data) {
      if (!data.revision)
        return { response: JSON.stringify({ texts: { businessScheme: rejected } }) };
      expect(data.revision.issues.businessScheme).toContain('監修者と再撮影禁止が欠落');
      expect(data.revision.issues.businessScheme).toContain('100');
      expect(Object.keys(data.compactNodes)).toEqual(['businessScheme']);
    }
    if ('verifyCompaction' in data && checks++ === 0)
      return {
        response: JSON.stringify({
          checks: {
            businessScheme: {
              text: rejected,
              preserved: false,
              grounded: true,
              reason: '監修者と再撮影禁止が欠落',
            },
          },
        }),
      };
    return base(model, input);
  });
  const score = await generatePufu(env(ai), {
    ...context,
    details: longCondition + '資料を保存する。',
  });
  expect(score.elements.businessScheme.text).toBe(shortCondition);
  expect(ai.mock.calls).toHaveLength(8);
});

it('検証入力を超える巨大な短文化候補は検証AIを繰り返し呼ばず停止する', async () => {
  const ai = compactProvider(true);
  const base = ai.getMockImplementation()!;
  ai.mockImplementation(async (model, input) => {
    const data = JSON.parse(input.messages[1].content);
    if ('compactNodes' in data)
      return {
        response: JSON.stringify({ texts: { businessScheme: '大きすぎる候補。'.repeat(3000) } }),
      };
    return base(model, input);
  });
  await expect(
    generatePufu(env(ai), { ...context, details: longCondition + '資料を保存する。' }),
  ).rejects.toThrow('検証の入力上限');
  expect(ai.mock.calls).toHaveLength(3);
});

it('不合格の要素だけを元へ戻し、別要素の合格短文は保持する', async () => {
  const ai = compactProvider(false);
  const base = ai.getMockImplementation()!;
  const quality = '映像は原則として元の内容を変えず、作品の方針を尊重する。';
  ai.mockImplementation(async (model, input) => {
    const data = JSON.parse(input.messages[1].content);
    if ('compactNodes' in data) {
      if (data.revision) expect(Object.keys(data.compactNodes)).toEqual(['businessScheme']);
      return {
        response: JSON.stringify({
          texts: { businessScheme: shortCondition, ...(!data.revision ? { quality } : {}) },
        }),
      };
    }
    if ('verifyCompaction' in data)
      return {
        response: JSON.stringify({
          checks: {
            businessScheme: {
              text: shortCondition,
              preserved: false,
              grounded: true,
              reason: '判断条件の一部が欠落。',
            },
            quality: {
              text: quality,
              preserved: true,
              grounded: true,
              reason: '映像方針と原則の留保を維持。',
            },
          },
        }),
      };
    const response = await base(model, input);
    const raw = JSON.parse((response as { response: string }).response);
    if ('sources' in data)
      raw.elements.quality = [
        {
          evidence: 'E1',
          scope: 'project',
          text: '映像は原則として元の内容を変えず、作品ごとの方針を尊重するという基本的な姿勢をとる。',
        },
        {
          evidence: 'E1',
          scope: 'project',
          text: '修復の際も原則として映像に含まれる元の内容や表現を変えず、作品固有の方針を尊重する姿勢を保ち、担当者もそれぞれの作品に合意された方針に従って映像の内容を維持する。',
        },
      ];
    return { response: JSON.stringify(raw) };
  });
  const score = await generatePufu(env(ai), {
    ...context,
    details: longCondition + '資料を保存する。',
  });
  expect(score.elements.quality.text).toBe(quality);
  expect(score.elements.businessScheme.text).toContain('監修者に最初にサンプルを見せ');
  expect(score.elements.businessScheme.text).not.toBe(shortCondition);
});

it('短文化の利用枠到達後は完了した工程を再送せず再開し、短文をDB保存する', async () => {
  const app = await testApp();
  try {
    const ai = compactProvider(true);
    app.env.AI = { run: ai };
    app.env.AI_CALL_DAILY_LIMIT = '3';
    const response = await app.request('/api/v1/projects/alice-project/pufus/generate', {
      method: 'POST',
      body: {
        task: context.task,
        details: longCondition + '資料を保存する。',
        request_id: crypto.randomUUID(),
      },
    });
    expect(response.status).toBe(202);
    const { id } = (await response.json()) as { id: string };
    const job = (await app.env.DB.prepare('SELECT * FROM processing_jobs WHERE target_id=?')
      .bind(id)
      .first<Job>())!;
    await runPufu(app.env, job, mockStep());
    expect(
      await app.env.DB.prepare('SELECT status,score_json FROM pufu_scores WHERE id=?')
        .bind(id)
        .first(),
    ).toMatchObject({ status: 'queued', score_json: null });
    app.env.AI_CALL_DAILY_LIMIT = '6';
    await runPufu(app.env, job, mockStep());
    const saved = (await app.env.DB.prepare('SELECT status,score_json FROM pufu_scores WHERE id=?')
      .bind(id)
      .first<{ status: string; score_json: string }>())!;
    expect(saved.status).toBe('ready');
    expect(JSON.parse(saved.score_json).elements.businessScheme.text).toBe(shortCondition);
    expect(await app.env.DB.prepare('SELECT COUNT(*) n FROM ai_attempts').first()).toEqual({
      n: 6,
    });
    expect(
      ai.mock.calls.filter(([, input]) => 'sources' in JSON.parse(input.messages[1].content)),
    ).toHaveLength(1);
    expect(
      ai.mock.calls.filter(([, input]) => 'compactNodes' in JSON.parse(input.messages[1].content)),
    ).toHaveLength(1);
  } finally {
    await app.dispose();
  }
});

it('修復後も根拠が不一致なら抽出全体を再生成せず停止する', async () => {
  const ai = mockPufuAi(draft);
  const base = ai.getMockImplementation()!;
  const invalid = {
    evidence: 'E1',
    scope: 'project',
    element: 'money',
    text: '購入はしない。',
    quote: '存在しない引用。',
  };
  ai.mockImplementation(async (model, input) => {
    const data = JSON.parse(input.messages[1].content);
    if ('repairFacts' in data) return { response: JSON.stringify({ 'conditions[0]': invalid }) };
    const response = await base(model, input);
    const value = JSON.parse((response as { response: string }).response);
    if ('sources' in data) value.conditions = [invalid];
    return { response: JSON.stringify(value) };
  });
  await expect(generatePufu(env(ai), context)).rejects.toThrow('condition_quote_not_in_evidence');
  expect(ai.mock.calls).toHaveLength(2);
});

it('入力に長い金銭条件があっても独立検証後に元の長文へ戻さない', async () => {
  const money =
    '予算は50万円以内とし、新しい機材や追加の機材は購入せず、既存の機材を使い、購入のための予算増額は行わず、作業範囲は使える時間と限られた予算に合わせて決め、追加費用が必要な作業は依頼者が実施可否を判断し、契約した範囲を超えて作業を進めない。';
  const short =
    '予算50万円以内・追加購入と増額なし。既存機材を使い、時間・予算・契約範囲を守り、追加費用を伴う作業は依頼者が判断。';
  const ai = mockPufuAi({
    ...draft,
    elements: { money: '予算は50万円以内。新しい機材は購入しない。' },
  });
  const base = ai.getMockImplementation()!;
  ai.mockImplementation(async (model, input) => {
    const data = JSON.parse(input.messages[1].content);
    if ('compactNodes' in data) return { response: JSON.stringify({ texts: { money: short } }) };
    if ('verifyCompaction' in data)
      return {
        response: JSON.stringify({
          checks: {
            money: {
              text: short,
              preserved: true,
              grounded: true,
              reason: '予算・購入禁止・判断者を維持。',
            },
          },
        }),
      };
    return base(model, input);
  });
  const score = await generatePufu(env(ai), { ...context, details: money + '資料を保存する。' });
  expect(score.elements.money.text).toBe(short);
});

it.each(['scope', 'kind', 'text'] as const)(
  '根拠修復で%sを書き換えて条件・事例を落とす応答は拒否する',
  async (field) => {
    const ai = mockPufuAi(draft);
    const base = ai.getMockImplementation()!;
    const value =
      field === 'kind'
        ? { evidence: 'E999', subject: '資料', text: '原版を使用。', kind: 'actual' }
        : {
            evidence: 'E1',
            scope: 'project',
            element: 'money',
            text: '購入はしない。',
            quote: '存在しない引用。',
          };
    const path = field === 'kind' ? 'cases.materials[0]' : 'conditions[0]';
    ai.mockImplementation(async (model, input) => {
      const data = JSON.parse(input.messages[1].content);
      if ('repairFacts' in data)
        return {
          response: JSON.stringify({
            [path]: {
              ...value,
              evidence: field === 'kind' ? 'E0' : 'E1',
              ...(field === 'kind'
                ? { kind: 'background' }
                : {
                    quote: '購入はしない。',
                    [field]: field === 'scope' ? 'option' : '購入してよい。',
                  }),
            },
          }),
        };
      const response = await base(model, input);
      const raw = JSON.parse((response as { response: string }).response);
      if ('sources' in data) {
        if (field === 'kind') raw.cases = { materials: [value], decisions: [], processing: [] };
        else raw.conditions = [value];
      }
      return { response: JSON.stringify(raw) };
    });
    await expect(generatePufu(env(ai), context)).rejects.toThrow('出力形式');
  },
);

it('配置先が不正な事例を元の施策番号で修復し、正しい施策だけに配置する', async () => {
  const actions = ['方針を相談する。', '音声を修復する。', '資料を保存する。'];
  const ai = mockPufuAi({
    ...draft,
    gainingGoal: '作品Aの修復版',
    purposes: actions.map((text) => ({
      text: '工程の結果が得られている。',
      measures: [{ text, color: 'white' }],
    })),
  });
  const base = ai.getMockImplementation()!;
  const value = {
    evidence: 'E1',
    subject: '作品A',
    text: '台詞を分離した。',
    kind: 'actual',
    actionIndex: 11,
  };
  ai.mockImplementation(async (model, input) => {
    const data = JSON.parse(input.messages[1].content);
    if ('repairFacts' in data) {
      expect(data.actionOrder).toEqual([
        { actionIndex: 0, text: '方針を相談する。', scope: 'project' },
        { actionIndex: 1, text: '音声を修復する。', scope: 'project' },
        { actionIndex: 2, text: '資料を保存する。', scope: 'project' },
      ]);
      return {
        response: JSON.stringify({
          'cases.processing[0]': { ...value, evidence: 'E3', actionIndex: 1 },
        }),
      };
    }
    const response = await base(model, input);
    const raw = JSON.parse((response as { response: string }).response);
    if ('sources' in data) raw.cases = { materials: [], decisions: [], processing: [value] };
    return { response: JSON.stringify(raw) };
  });
  const score = await generatePufu(env(ai), {
    ...context,
    task: '',
    details: '',
    stock: {
      id: 's',
      title: '作品Aの修復',
      note: '',
      summary: null,
      content: '方針を相談する。音声を修復する。資料を保存する。作品Aでは台詞を分離した。',
    },
  });
  const measures = score.purposes.flatMap((p) => p.measures.map((m) => m.text));
  expect(measures).toEqual([
    '方針を相談する。',
    '音声を修復する。 「作品A」では、台詞を分離した。',
    '資料を保存する。',
  ]);
});
