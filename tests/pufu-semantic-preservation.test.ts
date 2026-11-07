import { expect, it, vi } from 'vitest';
import { extractPufuFacts } from '../server/pufu-source-facts';
import { arrangePufu } from '../server/pufu-plan';
import { reviewPufuWin } from '../server/pufu-win-review';
import { elementKeys, type PufuContext, pufuScoreSchema } from '../shared/pufu';
import type { Env } from '../server/env';
import { reviewDraft } from './pufu-ai-fixture';

const context: PufuContext = {
  task: '資料の保存',
  details: '資料を保存する。原本は削除しない。上映可否は依頼者が判断する。',
  project: { id: 'p', name: '資料', description: '' },
  stock: null,
  question: null,
  userMemory: null,
  projectMemory: null,
};
const env = (run: NonNullable<Env['AI']>['run']) =>
  ({ AI: { run }, AI_MODEL: 'test' }) as unknown as Env;
const elements = Object.fromEntries(elementKeys.map((key) => [key, [] as string[]])) as Record<
  (typeof elementKeys)[number],
  string[]
>;
const condition = {
  evidence: 'E1',
  scope: 'project',
  element: 'environment',
  text: '原本は削除しない。',
  quote: '原本は削除しない。',
};

it('通常の八要素抽出が空でも、原文照合した禁止条件を構成へ引き継ぐ', async () => {
  const run = vi.fn().mockResolvedValue({
    response: {
      actions: [{ evidence: 'E1', scope: 'project', text: '資料を保存する。' }],
      completionActions: [],
      elements,
      conditions: [condition],
    },
  });
  const facts = await extractPufuFacts(env(run), context, 'ja');
  expect(facts).toMatchObject({ conditions: [{ element: 'environment', text: condition.text }] });
  const plan = vi
    .fn()
    .mockResolvedValue({ response: { purposes: [{ text: '資料が保存されている。' }] } });
  const score = await arrangePufu(env(plan), context, facts, 'ja');
  expect(score.elements.environment.text).toContain(condition.text);
});

it('原資料に存在しない引用を持つ条件を受理しない', async () => {
  const run = vi.fn().mockResolvedValue({
    response: {
      actions: [],
      completionActions: [],
      elements,
      conditions: [{ ...condition, quote: '原本は削除してよい。' }],
    },
  });
  await expect(extractPufuFacts(env(run), context, 'ja')).rejects.toThrow('根拠');
});

it('240字枠の事例・背景より禁止条件を優先し、条件自体が収まらなければ黙って省かない', async () => {
  const run = vi
    .fn()
    .mockResolvedValue({ response: { purposes: [{ text: '資料が保存されている。' }] } });
  const facts = {
    actions: ['資料を保存する。'],
    elements: { ...elements, environment: ['背景。'.repeat(79)] },
    conditions: [{ element: 'environment' as const, text: condition.text }],
  };
  const score = await arrangePufu(env(run), context, facts, 'ja');
  expect(score.elements.environment.text).toContain(condition.text);
  await expect(
    arrangePufu(
      env(run),
      context,
      { ...facts, conditions: [{ element: 'environment' as const, text: '制約。'.repeat(81) }] },
      'ja',
    ),
  ).rejects.toThrow('条件');
});

it.each(
  [
    'decisionTarget',
    'completedOutcome',
    'claimStrength',
    'constraintCoverage',
    'readableSentence',
  ].flatMap((key) => [
    { key, location: 'details' },
    { key, location: 'question' },
  ]),
)(
  '旧来の判定が全合格でも、$locationに基づく意味検証$keyの不合格を修復へ渡す',
  async ({ key, location }) => {
    const reason = '上映可否を保存可否へ変更している。';
    const score = pufuScoreSchema.parse({
      gainingGoal: { uuid: 'g', text: context.task, comment: { color: 'blue', text: '' } },
      winCondition: {
        uuid: 'w',
        text: '保存可否を判断できる状態。',
        comment: { color: 'blue', text: '' },
      },
      purposes: [
        {
          uuid: 'p',
          text: '資料が保存されている。',
          measures: [],
          comment: { color: 'blue', text: '' },
        },
      ],
      elements: Object.fromEntries(
        elementKeys.map((k) => [k, { uuid: k, text: '', comment: { color: 'blue', text: '' } }]),
      ),
    });
    const checks = Object.fromEntries(
      [
        'decisionTarget',
        'completedOutcome',
        'claimStrength',
        'constraintCoverage',
        'readableSentence',
      ].map((name) => [
        name,
        {
          passed: name !== key,
          reason: name === key ? reason : '資料と候補の内容を照合した。',
          sourceQuote: name === key ? '上映可否は依頼者が判断する。' : '',
          candidateQuote: name === key ? '保存可否を判断できる状態。' : '',
        },
      ]),
    );
    const run = vi.fn().mockResolvedValue({
      response: {
        ...reviewDraft({ purposes: [{ purpose: 1 }] }),
        issues: ['既存の指摘1', '既存の指摘2', '既存の指摘3'],
        meaningChecks: checks,
      },
    });
    const sourceContext: PufuContext =
      location === 'question'
        ? {
            ...context,
            details: '',
            question: { id: 'q', text: context.details ?? '', source: 'user' },
          }
        : context;
    const result = await reviewPufuWin(
      env(run),
      sourceContext,
      { actions: [], elements },
      score,
      'ja',
    );
    expect(result.issues).toContain(reason);
  },
);

it('検証モデルが捏造した禁止条件を、原文照合なしに修復理由として採用しない', async () => {
  const score = pufuScoreSchema.parse({
    gainingGoal: { uuid: 'g', text: context.task, comment: { color: 'blue', text: '' } },
    winCondition: {
      uuid: 'w',
      text: '資料が保存されている。',
      comment: { color: 'blue', text: '' },
    },
    purposes: [
      {
        uuid: 'p',
        text: '資料が保存されている。',
        measures: [],
        comment: { color: 'blue', text: '' },
      },
    ],
    elements: Object.fromEntries(
      elementKeys.map((key) => [
        key,
        { uuid: key, text: '', comment: { color: 'blue', text: '' } },
      ]),
    ),
  });
  const review = reviewDraft({ purposes: [{ purpose: 1 }] });
  const checks = Object.fromEntries(
    Object.entries(review.meaningChecks).map(([key, value]) => [
      key,
      { ...value, sourceQuote: '', candidateQuote: '' },
    ]),
  );
  checks.constraintCoverage = {
    passed: false,
    reason: '資料にない公開禁止を要求している。',
    sourceQuote: '外部公開は禁止する。',
    candidateQuote: '',
  };
  const run = vi.fn().mockResolvedValue({ response: { ...review, meaningChecks: checks } });
  await expect(
    reviewPufuWin(env(run), context, { actions: [], elements }, score, 'ja'),
  ).rejects.toThrow('根拠');
});

it('禁止事項だけの資料でも、整形による再配置で重要条件が消えたら成功にしない', async () => {
  const policies = ['基礎', '応用', '運用', '管理', '保守', '移管'].map(
    (prefix) => `${prefix}${'研修'.repeat(20)}は行わない。`,
  );
  const conditions = policies.map((text, index) => ({
    element: (index < 3 ? 'quality' : 'environment') as 'quality' | 'environment',
    text,
  }));
  const run = vi.fn().mockResolvedValue({ response: { purposes: [] } });
  await expect(
    arrangePufu(
      env(run),
      { ...context, details: policies.join('') },
      { actions: [], elements, conditions },
      'ja',
    ),
  ).rejects.toThrow('条件');
});
