import { expect, it, vi } from 'vitest';
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
const provider = (result: unknown) =>
  vi
    .fn<NonNullable<Env['AI']>['run']>()
    .mockResolvedValueOnce({ response: JSON.stringify(facts) })
    .mockResolvedValueOnce({ response: JSON.stringify(result) });
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
    '作品側と合意した方針に基づき、素材選定・補修・クリーニング・スキャン・ゴミ除去・音声処理・グレーディング・巻つなぎを経て、用途別のデータが作成されている。',
  ],
  [
    'en',
    'The team has prepared the materials, checked each intermediate result, reviewed the findings with the project owner and delivered the completed guide for its intended use.',
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
  const run = vi
    .fn<NonNullable<Env['AI']>['run']>()
    .mockResolvedValueOnce({
      response: JSON.stringify({
        ...facts,
        actions: facts.actions.slice(0, 2),
        completionActions: facts.actions.slice(2),
      }),
    })
    .mockResolvedValueOnce({ response: JSON.stringify(plan) });
  const score = await generatePufu(env(run), context);
  expect(score.purposes.flatMap((p) => p.measures.map((m) => m.text))).toEqual(actions);
  expect(score.purposes.at(-1)!.measures.at(-1)!.text).toBe('成果物を納品する。');
});
