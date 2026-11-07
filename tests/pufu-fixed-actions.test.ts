import { mockPufuStages } from './pufu-ai-fixture';
import { expect, it } from 'vitest';
import { generatePufu } from '../server/pufu';
import { elementKeys, type PufuContext } from '../shared/pufu';
import type { Env } from '../server/env';

const context: PufuContext = {
  task: '運用手順書',
  details: '準備する。検証する。成果物を納品する。',
  project: { id: 'p', name: '運用', description: '' },
  question: null,
  stock: null,
  userMemory: null,
  projectMemory: null,
};
const actions = ['準備する。', '検証する。', '成果物を納品する。'];
const facts = {
  completionActions: [],
  actions: actions.map((text) => ({ evidence: 'E1', scope: 'project', text })),
  elements: Object.fromEntries(elementKeys.map((key) => [key, []])),
};
const plan = {
  winCondition: '担当者が成果物を活用できる。',
  purposes: [
    { text: '準備が整っている。' },
    { text: '検証結果が得られている。' },
    { text: '成果物が納品されている。' },
  ],
};
const provider = (result: unknown) => mockPufuStages(facts, result);
const env = (run: NonNullable<Env['AI']>['run']) =>
  ({ AI: { run }, AI_MODEL: 'test' }) as unknown as Env;

it('抽出された全施策を抽出順に固定し、構成AIに省略や取り違えを許さない', async () => {
  const run = provider(plan);
  const score = await generatePufu(env(run), context);
  expect(score.winCondition.text).toBe(plan.winCondition);
  expect(score.purposes.map((purpose) => purpose.measures.map((measure) => measure.text))).toEqual(
    actions.map((text) => [text]),
  );
  expect(JSON.parse(run.mock.calls[1][1].messages[1].content).actionGroups).toEqual(
    actions.map((text, index) => ({ purpose: index + 1, actions: [text] })),
  );
});

it.each([
  [
    'ja',
    '作品側と合意した方針に基づき、素材選定・補修・クリーニング・スキャン・ゴミ除去・音声処理・グレーディング・巻つなぎを経て、用途別のデータが作成され、担当者間で全作業の順序と完了状況を確認した上で、依頼者と監督が最終結果を確認し、各用途向けのデータを保存先からいつでも参照できる状態になっている。',
  ],
  [
    'en',
    'The team has prepared all materials, carefully checked each intermediate result, reviewed the findings with the project owner, completed the entire planned procedure, and delivered the completed guide with a detailed record of every inspection and its observed results for the intended use.',
  ],
  ['ja', '成果物が納品されている。検証結果も確認できる。'],
  ['en', 'The guide is delivered. The check results are available.'],
  ['en', 'Dr. Smith has the check results. The guide is delivered.'],
] as const)('長すぎる勝利条件や複数文を受理しない: %s %s', async (language, winCondition) => {
  await expect(
    generatePufu(env(provider({ ...plan, winCondition })), context, language),
  ).rejects.toThrow('出力形式');
});

it('英語の役職略語にあるピリオドを文末とみなさない', async () => {
  const winCondition = "The results are ready for Dr. Smith's decision.";
  const score = await generatePufu(env(provider({ ...plan, winCondition })), context, 'en');
  expect(score.winCondition.text).toBe(winCondition);
});

it('構成モデルが目的のまとまりを減らして最終成果物の施策を落とそうとしても受理しない', async () => {
  await expect(
    generatePufu(env(provider({ ...plan, purposes: plan.purposes.slice(0, 2) })), context),
  ).rejects.toThrow('出力形式');
});

it('構成モデルが施策の指定を追加しても、サーバーが固定した配置を上書きさせない', async () => {
  await expect(
    generatePufu(
      env(provider({ ...plan, purposes: plan.purposes.map((p) => ({ ...p, measures: [] })) })),
      context,
    ),
  ).rejects.toThrow('出力形式');
});

it('前半の工程とは別に抽出した完了工程も、最後の群へ必ず配置する', async () => {
  const run = mockPufuStages(
    { ...facts, actions: facts.actions.slice(0, 2), completionActions: facts.actions.slice(2) },
    plan,
  );
  const score = await generatePufu(env(run), context);
  expect(score.purposes.flatMap((p) => p.measures.map((m) => m.text))).toEqual(actions);
  expect(score.purposes.at(-1)!.measures.at(-1)!.text).toBe('成果物を納品する。');
});

it('短くするために英単語を切らず、140字を超える必要な完全文を240字まで保持する', async () => {
  const winCondition =
    "The technician's inspection findings and the saved report's logged location and date are available to the supervisor, who decides whether the equipment may be used.";
  expect(winCondition.length).toBeGreaterThan(140);
  const score = await generatePufu(env(provider({ ...plan, winCondition })), context, 'en');
  expect(score.winCondition.text).toBe(winCondition);
});
