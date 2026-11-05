import { expect, it, vi } from 'vitest';
import { generatePufu } from '../server/pufu';
import type { Env } from '../server/env';
import type { PufuContext, PufuScore } from '../shared/pufu';

const elements = {
  people: '修復担当と監督が映像方針を確認する体制。',
  money: '予算に応じた修復範囲の調整が必要。',
  time: 'フレーム単位の作業に時間がかかり、方針変更は手戻りを生む。',
  quality: '傷や汚れを除去しつつ、雨・星・フィルムの質感を残す。',
  businessScheme: '依頼者・監督が方針を決め、修復会社が工程を担う。',
  environment: '原版フィルムが劣化し、フィルム上映の機会も減少している。',
  rival: '',
  foreignEnemy: '',
};
const draft = {
  winCondition: '作品本来の表現を保った映像を、現代の上映環境で鑑賞できる。',
  purposes: [
    {
      text: '修復する範囲と残す表現について合意できている。',
      measures: [{ text: '修復サンプルを監督と確認し、映像方針を合わせる。', color: 'green' }],
    },
    {
      text: '元の表現を保ちながら、傷や汚れが除去されている。',
      measures: [{ text: '自動除去の結果を目視し、雨や星の消失を修正する。', color: 'blue' }],
    },
  ],
  elements,
};
const context: PufuContext = {
  task: '作品本来の表現を保ったリマスター版',
  project: { id: 'p', name: '修復の計画', description: '' },
  question: null,
  userMemory: null,
  projectMemory: null,
  stock: {
    id: 's',
    title: 'リマスターの工程',
    note: '',
    summary: null,
    content:
      '依頼者と監督が初期に仕上がりを決め、修復会社がサンプルを提出する。予算と時間によって修復の範囲が変わる。自動処理で雨や星を消すことがあるため目視で確認し、フィルムの粒子感も残す。原版の劣化と上映機会の減少が進んでいる。',
  },
};
const nodes = (score: PufuScore) => [
  score.gainingGoal,
  score.winCondition,
  ...score.purposes.flatMap((p) => [p, ...p.measures]),
  ...Object.values(score.elements),
];

it('記事の言い換えを短い施策・八要素として保存し、自動コメントや参考注記を付けない', async () => {
  const run = vi.fn(async () => ({ response: JSON.stringify(draft) }));
  const score = await generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, context);
  expect(score.gainingGoal.text).toBe(context.task);
  expect(score.purposes[0].measures[0].text).toBe(
    '修復サンプルを監督と確認し、映像方針を合わせる。',
  );
  expect(
    Object.fromEntries(Object.entries(score.elements).map(([key, node]) => [key, node.text])),
  ).toEqual(elements);
  expect(Object.values(score.elements).filter((node) => node.text).length).toBe(6);
  expect(nodes(score).every((node) => node.comment.text === '')).toBe(true);
  expect(nodes(score).every((node) => !/^参考|^出典|^仮説/.test(node.text))).toBe(true);
  expect(run).toHaveBeenCalledTimes(1);
});

it('空欄の目標は成果物を推測し、仮説等の接頭辞やコメントを追加しない', async () => {
  const run = vi.fn(async () => ({
    response: JSON.stringify({ ...draft, gainingGoal: '作品本来の表現を保ったリマスター版' }),
  }));
  const score = await generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, {
    ...context,
    task: '',
  });
  expect(score.gainingGoal.text).toBe('作品本来の表現を保ったリマスター版');
  expect(nodes(score).every((node) => node.comment.text === '')).toBe(true);
});

it('分からない八要素は空欄で保存し、未確認という文章で全欄を埋めない', async () => {
  const run = vi.fn(async () => ({
    response: JSON.stringify({
      ...draft,
      elements: {
        people: '',
        money: '',
        time: '',
        quality: '傷を増やさず修復する必要がある。',
        businessScheme: '',
        environment: '',
        rival: '',
        foreignEnemy: '',
      },
      purposes: [{ text: '修復方針が整理されている。', measures: [] }],
    }),
  }));
  const score = await generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, context);
  expect(score.elements.money.text).toBe('');
  expect(score.elements.quality.text).toBe('傷を増やさず修復する必要がある。');
  expect(score.purposes[0].measures).toEqual([]);
  expect(nodes(score).every((node) => node.comment.text === '')).toBe(true);
});

it.each([
  { sourceId: 'article:0:0', quote: '原文の長い引用', color: 'white' },
  { text: '長'.repeat(241), color: 'white' },
])('旧引用形式や長すぎる自動生成文をプ譜本文へ転記しない', async (measure) => {
  const run = vi.fn(async () => ({
    response: JSON.stringify({
      ...draft,
      purposes: [{ text: '状態が整っている。', measures: [measure] }],
    }),
  }));
  await expect(
    generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, context),
  ).rejects.toThrow('出力形式');
});

it.each([
  { task: '目'.repeat(1000), title: '記事' },
  { task: '', title: '題'.repeat(200) },
])('長い入力のデモでも生成文の上限を守る', async ({ task, title }) => {
  const score = await generatePufu(
    { LOCAL_DEMO_ENABLED: 'true', APP_URL: 'http://localhost' } as Env,
    { ...context, task, stock: { ...context.stock!, title } },
  );
  expect(score.gainingGoal.text.length).toBeLessThanOrEqual(task ? 1000 : 200);
  expect(score.winCondition.text.length).toBeLessThanOrEqual(240);
  if (task) expect(score.gainingGoal.text).toBe(task);
});

it('プ譜専用モデルのchoices応答から最終回答だけを保存する', async () => {
  const run = vi.fn(async (_model: string, _input: unknown) => ({
    choices: [
      {
        message: {
          role: 'assistant',
          content: JSON.stringify(draft),
          reasoning_content: '内部検討は保存しない。',
        },
      },
    ],
  }));
  const score = await generatePufu(
    {
      AI: { run },
      AI_MODEL: 'default-model',
      AI_PUFU_MODEL: '@cf/zai-org/glm-4.7-flash',
    } as unknown as Env,
    context,
  );
  expect(run.mock.calls[0]?.[0]).toBe('@cf/zai-org/glm-4.7-flash');
  expect(score.winCondition.text).toBe(draft.winCondition);
  expect(nodes(score).every((node) => node.comment.text === '')).toBe(true);
});

it('GLM-5.3では思考量をlowに制限し、対応するJSON Schema形式で1回だけ生成する', async () => {
  const response = {
    ...draft,
    purposes: [],
    elements: Object.fromEntries(
      Object.keys(elements).map((key) => [key, { evidence: '', text: '' }]),
    ),
  };
  const run = vi.fn(async (_model: string, _input: unknown) => ({
    choices: [{ message: { content: JSON.stringify(response), reasoning_content: '保存しない' } }],
  }));
  const score = await generatePufu(
    {
      AI: { run },
      AI_MODEL: 'default-model',
      AI_PUFU_MODEL: '@cf/zai-org/glm-5.3-flash',
    } as unknown as Env,
    context,
  );
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]?.[0]).toBe('@cf/zai-org/glm-5.3-flash');
  const input = run.mock.calls[0]?.[1] as Record<string, unknown>;
  expect(input).toMatchObject({
    reasoning_effort: 'low',
    max_tokens: 6000,
    response_format: { type: 'json_schema', json_schema: { name: 'pufu', strict: true } },
  });
  expect(input).not.toHaveProperty('chat_template_kwargs');
  expect(JSON.stringify(score)).not.toContain('保存しない');
});

it('目標も問いもない記事の構成では、同じ呼出し・出力上限の中で方針の整合性を考慮する', async () => {
  const response = {
    gainingGoal: '依頼者と合意した方針を満たすリマスター映像',
    winCondition: draft.winCondition,
    purposes: [],
    elements: Object.fromEntries(
      Object.keys(elements).map((key) => [key, { evidence: '', text: '' }]),
    ),
  };
  const run = vi.fn(async (_model: string, _input: unknown) => ({
    choices: [{ message: { content: JSON.stringify(response) } }],
  }));
  await generatePufu(
    { AI: { run }, AI_MODEL: 'test', AI_PUFU_MODEL: '@cf/zai-org/glm-5.3-flash' } as unknown as Env,
    { ...context, task: '' },
  );
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]?.[1]).toMatchObject({ reasoning_effort: 'high', max_tokens: 6000 });
});

it('根拠箇所は内部で照合し、プ譜には言い換えた短文だけを保存する', async () => {
  const evidence = 'E1';
  const response = {
    winCondition: draft.winCondition,
    purposes: [
      {
        text: '修復方針が合意されている。',
        measures: [
          {
            evidence,
            text: '修復サンプルを提出して方針を確認する。',
            color: 'white',
          },
        ],
      },
    ],
    elements: Object.fromEntries(
      Object.keys(elements).map((key) => [
        key,
        key === 'people'
          ? { evidence, text: '依頼者・監督と修復会社が方針を確認する体制。' }
          : { evidence: '', text: '' },
      ]),
    ),
  };
  const run = vi.fn(async () => ({
    choices: [{ message: { content: JSON.stringify(response) } }],
  }));
  const score = await generatePufu(
    { AI: { run }, AI_MODEL: 'test', AI_PUFU_MODEL: '@cf/zai-org/glm-5.3-flash' } as unknown as Env,
    context,
  );
  expect(score.purposes[0].measures[0].text).toBe('修復サンプルを提出して方針を確認する。');
  expect(score.elements.people.text).toBe('依頼者・監督と修復会社が方針を確認する体制。');
  expect(JSON.stringify(score)).not.toContain('evidence');
  expect(JSON.stringify(score)).not.toContain(evidence);
  expect(nodes(score).every((node) => node.comment.text === '')).toBe(true);
});

it('本文にも明示入力にもない根拠文は、空欄へ黙って落とさず再試行可能なエラーにする', async () => {
  const response = {
    winCondition: draft.winCondition,
    purposes: [
      {
        text: '状態が整っている。',
        measures: [{ evidence: 'E999', text: '研修を開催する。', color: 'white' }],
      },
    ],
    elements: Object.fromEntries(
      Object.keys(elements).map((key) => [key, { evidence: '', text: '' }]),
    ),
  };
  const run = vi.fn(async () => ({
    choices: [{ message: { content: JSON.stringify(response) } }],
  }));
  await expect(
    generatePufu(
      {
        AI: { run },
        AI_MODEL: 'test',
        AI_PUFU_MODEL: '@cf/zai-org/glm-5.3-flash',
      } as unknown as Env,
      context,
    ),
  ).rejects.toThrow('根拠');
});

it('choices応答の最終回答がなければ思考過程を回答として保存しない', async () => {
  const run = vi.fn(async (_model: string, _input: unknown) => ({
    choices: [
      { message: { role: 'assistant', content: null, reasoning_content: JSON.stringify(draft) } },
    ],
  }));
  await expect(
    generatePufu(
      {
        AI: { run },
        AI_MODEL: 'default-model',
        AI_PUFU_MODEL: '@cf/zai-org/glm-4.7-flash',
      } as unknown as Env,
      context,
    ),
  ).rejects.toThrow('出力形式');
});

it('八要素の定型的な未定語だけを空欄にし、具体的な制約は保持する', async () => {
  const run = vi.fn(async () => ({
    response: JSON.stringify({
      ...draft,
      elements: {
        ...elements,
        money: '素材の選定や補修に伴うコストが発生する。',
        time: '未定',
        environment: '追加購入は行わない。',
      },
    }),
  }));
  const score = await generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, context);
  expect(score.elements.money.text).toBe('素材の選定や補修に伴うコストが発生する。');
  expect(score.elements.time.text).toBe('');
  expect(score.elements.environment.text).toBe('追加購入は行わない。');
});

it.each(['利用者に必要な情報が届く。', '受付の待ち時間が減る。', '受付の流れが整う。'])(
  '既に状態を表す中間目的を機械的に能力表現へ変えない: %s',
  async (text) => {
    const run = vi.fn(async () => ({
      response: JSON.stringify({
        ...draft,
        purposes: [{ text, measures: [] }],
      }),
    }));
    const score = await generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, context);
    expect(score.purposes[0].text).toBe(text);
  },
);

it('未定と不採用しかない資料から施策や担当関係を創作せず、明示された禁止条件を残す', async () => {
  const run = vi.fn(async () => ({
    response: JSON.stringify({
      ...draft,
      purposes: [
        {
          text: '実施計画がまとまっている。',
          measures: [{ text: '実施計画を策定する。', color: 'white' }],
        },
      ],
      elements: { ...elements, people: '未定', businessScheme: '依頼者と実行側が協力する。' },
    }),
  }));
  const score = await generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, {
    ...context,
    task: '検証方針を整理した文書',
    stock: {
      ...context.stock!,
      content: '検証の方針は未定。イベントは開催しない。担当者・予算・期限は決まっていない。',
    },
  });
  expect(score.purposes).toEqual([]);
  expect(score.winCondition.text).toBe('');
  expect(score.elements.people.text).toBe('');
  expect(score.elements.businessScheme.text).toBe('');
  expect(score.elements.environment.text).toBe('イベントは開催しない。');
});

it('異言語の未定資料でも翻訳された禁止条件を原文に戻さない', async () => {
  const run = vi.fn(async () => ({
    response: JSON.stringify({
      ...draft,
      elements: { ...elements, environment: 'Events are not held.' },
    }),
  }));
  const score = await generatePufu(
    { AI: { run }, AI_MODEL: 'test' } as unknown as Env,
    {
      ...context,
      stock: {
        ...context.stock!,
        content: '検証の方針は未定。イベントは開催しない。担当者・予算・期限は決まっていない。',
      },
    },
    'en',
  );
  expect(score.elements.environment.text).toBe('Events are not held.');
  expect(score.purposes).toEqual([]);
});

it('ユーザーが明示した費用・購入の制約を言い換えで弱めない', async () => {
  const run = vi.fn(async () => ({
    response: JSON.stringify({
      ...draft,
      elements: { ...elements, money: 'No additional purchases required.' },
    }),
  }));
  const score = await generatePufu(
    { AI: { run }, AI_MODEL: 'test' } as unknown as Env,
    {
      ...context,
      details: 'One technician. Use existing tools. No additional purchases.',
    },
    'en',
  );
  expect(score.elements.money.text).toBe('No additional purchases.');
});

it.each([
  '既存窓口で試験運用を行うが、イベントは開催しない。',
  '既存窓口で試験運用を行いイベントは開催しない。',
  '既存窓口で試験運用を行うが予算は未定。',
])('肯定と否定が混在する文から根拠ある施策を消さない: %s', async (content) => {
  const measures = [{ text: '既存窓口で試験運用を行う。', color: 'white' }];
  const run = vi.fn(async () => ({
    response: JSON.stringify({
      ...draft,
      purposes: [{ text: '窓口の運用を確認できる。', measures }],
    }),
  }));
  const score = await generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, {
    ...context,
    stock: { ...context.stock!, content },
  });
  expect(score.purposes[0]?.measures[0]?.text).toBe(measures[0].text);
  expect(score.elements.people.text).toBe(elements.people);
});

it.each([
  {
    language: 'en' as const,
    details: '予算は3万円以内。',
    money: 'Budget is capped at JPY 30,000.',
  },
  { language: 'ja' as const, details: 'No additional purchases.', money: '追加購入は行わない。' },
])('予算の原文保持で生成言語を上書きしない: $language', async ({ language, details, money }) => {
  const run = vi.fn(async () => ({
    response: JSON.stringify({
      ...draft,
      elements: { ...elements, money },
    }),
  }));
  const score = await generatePufu(
    { AI: { run }, AI_MODEL: 'test' } as unknown as Env,
    {
      ...context,
      details,
    },
    language,
  );
  expect(score.elements.money.text).toBe(money);
});

it.each(['購入者へヒアリングする。', 'Interview customers about their purchase experience.'])(
  '購入に言及した一般の施策を予算条件に変えない: %s',
  async (details) => {
    const run = vi.fn(async () => ({
      response: JSON.stringify({
        ...draft,
        elements: { ...elements, money: '' },
      }),
    }));
    const score = await generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, {
      ...context,
      details,
    });
    expect(score.elements.money.text).toBe('');
  },
);

it.each([
  '現行の手順書には品質基準が記載されていない。',
  '品質基準は記載されていないが、担当者が個別に判断する。',
])('プロジェクト内の情報欠如という実際の条件を消さない: %s', async (condition) => {
  const run = vi.fn(async () => ({
    response: JSON.stringify({
      ...draft,
      elements: { ...elements, quality: condition },
    }),
  }));
  const score = await generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, {
    ...context,
    stock: { ...context.stock!, content: `${condition}担当者ごとに判断が異なる。` },
  });
  expect(score.elements.quality.text).toBe(condition);
});
