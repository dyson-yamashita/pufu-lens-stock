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

it.each([
  'decisionTarget',
  'completedOutcome',
  'claimStrength',
  'constraintCoverage',
  'readableSentence',
])('旧来の判定が全合格でも、意味検証%sの不合格理由を修復へ渡す', async (key) => {
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
      { passed: name !== key, reason: name === key ? reason : '資料と候補の内容を照合した。' },
    ]),
  );
  const run = vi.fn().mockResolvedValue({
    response: { ...reviewDraft({ purposes: [{ purpose: 1 }] }), meaningChecks: checks },
  });
  const result = await reviewPufuWin(env(run), context, { actions: [], elements }, score, 'ja');
  expect(result.issues).toContain(reason);
});
