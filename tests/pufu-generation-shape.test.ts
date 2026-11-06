import { mockPufuAi } from './pufu-ai-fixture';
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
  const run = mockPufuAi(draft);
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
  expect(run).toHaveBeenCalledTimes(4);
});

it('点検結果を使用許可へ強めた勝利条件は独立検証の拒否で保存しない', async () => {
  const run = mockPufuAi(
    {
      ...draft,
      winCondition: 'Equipment is inspected and cleared for shift use.',
      purposes: [
        {
          text: 'Inspection results are available.',
          measures: [{ text: 'Inspect equipment.', color: 'white' }],
        },
      ],
      elements: { businessScheme: 'The supervisor decides whether equipment can be used.' },
    },
    ['使用許可を得た根拠がない。'],
  );
  await expect(
    generatePufu(
      { AI: { run }, AI_MODEL: 'test' } as unknown as Env,
      {
        ...context,
        task: 'Equipment inspection checklist',
        stock: {
          ...context.stock!,
          content: 'An operator inspects equipment. The supervisor decides whether it can be used.',
        },
      },
      'en',
    ),
  ).rejects.toThrow('勝利条件');
});

it('欠けの確認だけから欠けなしの要求を追加しない', async () => {
  const run = mockPufuAi({
    ...draft,
    winCondition: '画像の確認結果が記録されている。',
    purposes: [
      {
        text: '欠けのない画像が用意されている。',
        measures: [{ text: '画像の欠けを確認する。', color: 'white' }],
      },
    ],
    elements: { quality: '欠けのない画像。' },
  });
  const score = await generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, {
    ...context,
    stock: { ...context.stock!, content: '画像の欠けを目視で確認する。' },
  });
  expect(score.winCondition.text).toBe('画像の確認結果が記録されている。');
  expect(score.purposes[0].text).toBe('確認結果が得られている。');
  expect(score.purposes[0].measures[0].text).toBe('画像の欠けを確認する。');
  expect(score.elements.quality.text).toBe('');
  expect(score.gainingGoal.text).toBe(context.task);
});

it.each([
  {
    language: 'ja' as const,
    text: '画像を利用できる状態になっている。',
    fallback: '確認結果が得られている。',
  },
  {
    language: 'en' as const,
    text: 'The images are ready for use.',
    fallback: 'Check results are available.',
  },
])(
  '確認・登録だけから利用可能という結果を追加しない: $language',
  async ({ language, text, fallback }) => {
    const action =
      language === 'ja' ? '画像の欠けを確認して登録する。' : 'Check images and register them.';
    const run = mockPufuAi({
      ...draft,
      winCondition:
        language === 'ja'
          ? '画像の確認結果と登録記録が揃っている。'
          : 'Image check results and registration records are available.',
      purposes: [{ text, measures: [{ text: action, color: 'white' }] }],
      elements: { quality: text },
    });
    const score = await generatePufu(
      { AI: { run }, AI_MODEL: 'test' } as unknown as Env,
      { ...context, stock: { ...context.stock!, content: action } },
      language,
    );
    expect(score.winCondition.text).toBe(
      language === 'ja'
        ? '画像の確認結果と登録記録が揃っている。'
        : 'Image check results and registration records are available.',
    );
    expect(score.purposes[0].text).toBe(fallback);
    expect(score.elements.quality.text).toBe('');
  },
);

it.each([
  {
    language: 'ja' as const,
    condition: '利用できる状態の画像を納品する。',
    text: '画像を利用できる状態になっている。',
  },
  {
    language: 'en' as const,
    condition: 'The images must be ready for use.',
    text: 'The images are ready for use.',
  },
])('明示された利用可能という条件を保持する: $language', async ({ language, condition, text }) => {
  const run = mockPufuAi({ ...draft, winCondition: text, elements: { quality: text } });
  const score = await generatePufu(
    { AI: { run }, AI_MODEL: 'test' } as unknown as Env,
    { ...context, details: condition },
    language,
  );
  expect(score.winCondition.text).toBe(text);
  expect(score.elements.quality.text).toBe(text);
});

it.each([
  {
    language: 'ja' as const,
    condition: '画像は利用できるとは限らない。',
    text: '画像を利用できる状態になっている。',
  },
  {
    language: 'en' as const,
    condition: 'The images are not ready for use.',
    text: 'The images are ready for use.',
  },
])(
  '利用不可・未確定を利用可能の裏付けにしない: $language',
  async ({ language, condition, text }) => {
    const run = mockPufuAi({ ...draft, winCondition: text, elements: {} }, [
      '利用可能とは確認されていない。',
    ]);
    await expect(
      generatePufu(
        { AI: { run }, AI_MODEL: 'test' } as unknown as Env,
        { ...context, details: condition },
        language,
      ),
    ).rejects.toThrow('勝利条件');
  },
);

it('点検のない施策群へ別の群の点検結果を補わない', async () => {
  const run = mockPufuAi({
    ...draft,
    purposes: [
      {
        text: '欠けのない画像が作成されている。',
        measures: [{ text: '原稿をスキャンする。', color: 'white' }],
      },
      {
        text: '確認結果が得られている。',
        measures: [{ text: '画像の欠けを確認する。', color: 'white' }],
      },
    ],
    elements: {},
  });
  const score = await generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, {
    ...context,
    stock: { ...context.stock!, content: '原稿をスキャンし、画像の欠けを確認する。' },
  });
  expect(score.purposes[0].text).toBe('作業結果が得られている。');
});

it.each([true, false])('抜粋された本文を許可条件の裏付けにしない: %s', async (excerpted) => {
  const winCondition = '監督者の使用許可が得られている。';
  const run = mockPufuAi(
    {
      ...draft,
      winCondition,
      purposes: [
        {
          text: '確認結果が得られている。',
          measures: [{ text: '記録を確認する。', color: 'white' }],
        },
      ],
      elements: {},
    },
    excerpted ? ['抜粋された本文だけでは許可の根拠が不足する。'] : [],
  );
  const result = generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, {
    ...context,
    details: '記録を確認する。',
    stock: {
      ...context.stock!,
      content: '監督者の使用許可を得てから使う。',
      contentExcerpted: excerpted,
    },
  });
  if (excerpted) await expect(result).rejects.toThrow('勝利条件');
  else expect((await result).winCondition.text).toBe(winCondition);
});

it.each(['画像は欠けのない状態とする。', '監督者の使用許可を得てから使う。'])(
  '明示された品質条件や許可条件は保持する: %s',
  async (condition) => {
    const text = condition.includes('欠け')
      ? '欠けのない画像が揃っている。'
      : '監督者の使用許可が得られている。';
    const run = mockPufuAi({ ...draft, winCondition: text });
    const score = await generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, {
      ...context,
      details: condition,
    });
    expect(score.winCondition.text).toBe(text);
  },
);

it.each([
  'The supervisor must approve equipment before use.',
  'The supervisor authorizes equipment for use after inspection.',
])('承認の動詞形でも明示条件を保持する: %s', async (condition) => {
  const run = mockPufuAi({
    ...draft,
    winCondition: 'Equipment is approved for use.',
    elements: { quality: 'Supervisor approval is required before use.' },
  });
  const score = await generatePufu(
    { AI: { run }, AI_MODEL: 'test' } as unknown as Env,
    { ...context, details: condition },
    'en',
  );
  expect(score.winCondition.text).toBe('Equipment is approved for use.');
  expect(score.elements.quality.text).toBe('Supervisor approval is required before use.');
});

it.each([
  {
    condition: 'No approval is required, but the images must have no missing pages.',
    outcome: 'Images have no missing pages.',
  },
  {
    condition: '欠けのない画像を納品するが、色の再現性は保証できない。',
    outcome: '欠けのない画像が揃っている。',
  },
])('別条件の否定で明示品質を消さない: $condition', async ({ condition, outcome }) => {
  const run = mockPufuAi({ ...draft, winCondition: outcome, elements: { quality: outcome } });
  const score = await generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, {
    ...context,
    details: condition,
  });
  expect(score.winCondition.text).toBe(outcome);
  expect(score.elements.quality.text).toBe(outcome);
});

it('主語と述語の間の読点で保証不可を切り離さない', async () => {
  const run = mockPufuAi({ ...draft, winCondition: '欠けのない画像が揃っている。' }, [
    '欠けがないことは保証されていない。',
  ]);
  await expect(
    generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, {
      ...context,
      details: '欠けのない画像は、保証できない。',
    }),
  ).rejects.toThrow('勝利条件');
});

it('保証できないという記述を品質保証の裏付けとして使わない', async () => {
  const run = mockPufuAi({ ...draft, winCondition: '欠けのない画像が揃っている。' }, [
    '欠けがないことは保証されていない。',
  ]);
  await expect(
    generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, {
      ...context,
      stock: {
        ...context.stock!,
        content: '画像の欠けを確認するが、欠けのない画像を保証できない。',
      },
    }),
  ).rejects.toThrow('勝利条件');
});

it.each(['欠けのない画像は保証できない。', 'Approval is not required.'])(
  '保証や承認を否定する正しい条件は肯定の保証と誤認しない: %s',
  async (condition) => {
    const run = mockPufuAi({ ...draft, winCondition: condition });
    const score = await generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, {
      ...context,
      details: condition,
    });
    expect(score.winCondition.text).toBe(condition);
  },
);

it('空欄の目標は成果物を推測し、仮説等の接頭辞やコメントを追加しない', async () => {
  const run = mockPufuAi({ ...draft, gainingGoal: '作品本来の表現を保ったリマスター版' });
  const score = await generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, {
    ...context,
    task: '',
  });
  expect(score.gainingGoal.text).toBe('作品本来の表現を保ったリマスター版');
  expect(nodes(score).every((node) => node.comment.text === '')).toBe(true);
});

it('分からない八要素は空欄で保存し、未確認という文章で全欄を埋めない', async () => {
  const run = mockPufuAi({
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
  });
  const score = await generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, context);
  expect(score.elements.money.text).toBe('');
  expect(score.elements.quality.text).toBe('傷を増やさず修復する必要がある。');
  expect(score.purposes).toEqual([]);
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

it.each(['@cf/zai-org/glm-4.7-flash', '@cf/zai-org/glm-5.3-flash'])(
  'プ譜専用モデル%sで各段階の上限を守り、choicesの最終回答だけを保存する',
  async (model) => {
    const run = mockPufuAi(draft);
    const original = run.getMockImplementation()!;
    run.mockImplementation(async (...args) => {
      const answer = (await original(...args)) as { response: string };
      return {
        choices: [
          { message: { content: answer.response, reasoning_content: '内部検討は保存しない。' } },
        ],
      };
    });
    const score = await generatePufu(
      { AI: { run }, AI_MODEL: 'default-model', AI_PUFU_MODEL: model } as unknown as Env,
      context,
    );
    expect(run).toHaveBeenCalledTimes(4);
    expect(run.mock.calls.map(([name]) => name)).toEqual([model, model, model, model]);
    expect(run.mock.calls.map(([, input]) => input.max_tokens)).toEqual([6000, 2000, 2000, 1200]);
    for (const [, input] of run.mock.calls) {
      expect(input.response_format).toMatchObject({
        type: 'json_schema',
        json_schema: { name: 'pufu', strict: true },
      });
      if (model.includes('5.3'))
        expect(input).toMatchObject({
          reasoning_effort: input.max_tokens === 6000 ? 'low' : 'high',
        });
      else expect(input).toMatchObject({ chat_template_kwargs: { enable_thinking: false } });
      expect(input.messages[0].content).not.toContain('/no_think');
    }
    expect(score.winCondition.text).toBe(draft.winCondition);
    expect(nodes(score).every((node) => node.comment.text === '')).toBe(true);
    expect(JSON.stringify(score)).not.toContain('内部検討');
  },
);

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
  const run = mockPufuAi({
    ...draft,
    elements: {
      ...elements,
      money: '素材の選定や補修に伴うコストが発生する。',
      time: '未定',
      environment: '追加購入は行わない。',
    },
  });
  const score = await generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, context);
  expect(score.elements.money.text).toBe('素材の選定や補修に伴うコストが発生する。');
  expect(score.elements.time.text).toBe('');
  expect(score.elements.environment.text).toBe('追加購入は行わない。');
});

it.each(['利用者に必要な情報が届く。', '受付の待ち時間が減る。', '受付の流れが整う。'])(
  '既に状態を表す中間目的を機械的に能力表現へ変えない: %s',
  async (text) => {
    const run = mockPufuAi({
      ...draft,
      purposes: [{ text, measures: [{ text: '受付の状況を記録する。', color: 'white' }] }],
    });
    const score = await generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, context);
    expect(score.purposes[0].text).toBe(text);
  },
);

it('未定と不採用しかない資料から施策や担当関係を創作せず、明示された禁止条件を残す', async () => {
  const run = mockPufuAi({
    ...draft,
    purposes: [
      {
        text: '実施計画がまとまっている。',
        measures: [{ text: '実施計画を策定する。', color: 'white' }],
      },
    ],
    elements: { ...elements, people: '未定', businessScheme: '依頼者と実行側が協力する。' },
  });
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
  const run = mockPufuAi({
    ...draft,
    elements: { ...elements, environment: 'Events are not held.' },
  });
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
  const run = mockPufuAi({
    ...draft,
    elements: { ...elements, money: 'No additional purchases required.' },
  });
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

it('購入制約を原文に戻すときも、同じ事実にある既存の道具の条件を消さない', async () => {
  const run = mockPufuAi({
    ...draft,
    elements: { ...elements, money: 'No additional purchases; use existing tools.' },
  });
  const score = await generatePufu(
    { AI: { run }, AI_MODEL: 'test' } as unknown as Env,
    {
      ...context,
      details: 'One technician. Use existing tools. No additional purchases.',
    },
    'en',
  );
  expect(score.elements.money.text).toContain('No additional purchases');
  expect(score.elements.money.text).toContain('use existing tools.');
});

it.each([
  '既存窓口で試験運用を行うが、イベントは開催しない。',
  '既存窓口で試験運用を行いイベントは開催しない。',
  '既存窓口で試験運用を行うが予算は未定。',
])('肯定と否定が混在する文から根拠ある施策を消さない: %s', async (content) => {
  const measures = [{ text: '既存窓口で試験運用を行う。', color: 'white' }];
  const run = mockPufuAi({
    ...draft,
    purposes: [{ text: '窓口の運用を確認できる。', measures }],
  });
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
  const run = mockPufuAi({
    ...draft,
    elements: { ...elements, money },
  });
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
    const run = mockPufuAi({
      ...draft,
      elements: { ...elements, money: '' },
    });
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
  const run = mockPufuAi({
    ...draft,
    elements: { ...elements, quality: condition },
  });
  const score = await generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, {
    ...context,
    stock: { ...context.stock!, content: `${condition}担当者ごとに判断が異なる。` },
  });
  expect(score.elements.quality.text).toBe(condition);
});
