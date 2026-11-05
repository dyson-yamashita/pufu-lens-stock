import { expect, it, vi } from 'vitest';
import { generatePufu } from '../server/pufu';
import { arrangePufu } from '../server/pufu-plan';
import type { PufuFacts } from '../server/pufu-source-facts';
import type { Env } from '../server/env';
import { elementKeys, type PufuContext } from '../shared/pufu';

const context: PufuContext = {
  task: '運用チェックリスト',
  project: { id: 'p', name: '運用', description: '' },
  question: null,
  userMemory: null,
  projectMemory: null,
  stock: {
    id: 's',
    title: '手順',
    note: '',
    summary: null,
    content:
      '担当は2名。段階的デプロイをリハーサルで確認する。将来の上位規格には再取り込みで対応できる可能性がある。',
  },
};
const sourced = (text: string, scope = 'project') => ({ evidence: 'E1', scope, text });
const facts = {
  completionActions: [],
  actions: [
    sourced('段階的デプロイをリハーサルで確認する。'),
    sourced('将来の上位規格に対応できる可能性がある。', 'possibility'),
  ],
  elements: {
    ...Object.fromEntries(elementKeys.map((k) => [k, []])),
    people: [sourced('担当は2名。')],
    quality: [sourced('リハーサルを用いて確認する。')],
    environment: [sourced('既存の環境を利用する。'), sourced('他社は新型装置を使う。', 'example')],
  },
};
const plan = {
  winCondition: '運用担当が確認結果を使って判断できる。',
  purposes: [{ text: '段階的デプロイの確認結果が得られている。' }],
};
function provider(first: unknown = facts, second: unknown = plan) {
  return vi
    .fn<NonNullable<Env['AI']>['run']>()
    .mockResolvedValueOnce({ response: JSON.stringify(first) })
    .mockResolvedValueOnce({ response: JSON.stringify(second) });
}
const env = (run: NonNullable<Env['AI']>['run']) =>
  ({ AI: { run }, AI_MODEL: 'test' }) as unknown as Env;

it('事実の要約と構成を分け、施策と八要素には抽出した文をそのまま使う', async () => {
  const decision = '運用担当者が実施可否を決める。';
  const run = provider({
    ...facts,
    elements: { ...facts.elements, businessScheme: [sourced(decision)] },
  });
  const score = await generatePufu(env(run), context);
  expect(score.gainingGoal.text).toBe('運用チェックリスト');
  expect(score.purposes[0].measures[0].text).toBe('段階的デプロイをリハーサルで確認する。');
  expect(score.elements.quality.text).toBe('リハーサルを用いて確認する。');
  expect(score.elements.environment.text).toBe('既存の環境を利用する。');
  const layoutInput = run.mock.calls[1][1].messages[1].content;
  expect(layoutInput).toContain(decision);
  expect(layoutInput).not.toContain('リハーサルを用いて確認する。');
  expect(JSON.stringify(score)).not.toMatch(/必須|上位規格|他社|evidence|factId/);
  expect(score.winCondition.comment.text).toBe('');
});

it('構成モデルが施策の自由文を追加しても保存用のプ譜として受理しない', async () => {
  const run = provider(facts, {
    ...plan,
    purposes: [
      {
        ...plan.purposes[0],
        measures: [{ factId: 'A0', color: 'white', text: 'リハーサルの合格を必須にする。' }],
      },
    ],
  });
  await expect(generatePufu(env(run), context)).rejects.toThrow('出力形式');
});

it('将来の可能性と別事例を現在の施策・条件へ昇格させない', async () => {
  const score = await generatePufu(env(provider()), context);
  expect(score.purposes.flatMap((p) => p.measures.map((m) => m.text))).toEqual([
    '段階的デプロイをリハーサルで確認する。',
  ]);
  expect(score.elements.environment.text).toBe('既存の環境を利用する。');
});

it('対応可能な仕様を実施が決まった施策へ昇格させない', async () => {
  const run = provider({
    ...facts,
    actions: [...facts.actions, sourced('4Kに対応したサイズでデジタル化できる。', 'capability')],
  });
  const score = await generatePufu(env(run), context);
  expect(score.purposes.flatMap((p) => p.measures.map((m) => m.text))).toEqual([
    '段階的デプロイをリハーサルで確認する。',
  ]);
});

it('案件ごとに選択する工程・参加・納品物を、採用済みの施策へ昇格させない', async () => {
  const run = provider({
    ...facts,
    completionActions: [sourced('ソースマスターも納品することがある。', 'option')],
  });
  const score = await generatePufu(env(run), context);
  expect(
    score.purposes.flatMap((purpose) => purpose.measures.map((measure) => measure.text)),
  ).toEqual(['段階的デプロイをリハーサルで確認する。']);
});

it.each([
  'ソースマスターを納品することがある。',
  'The source master may also be delivered.',
  'The source master is sometimes delivered.',
])('projectへ誤分類された任意工程も構成へ渡さない: %s', async (optional) => {
  const run = provider({
    ...facts,
    completionActions: [sourced(optional)],
  });
  const score = await generatePufu(env(run), context);
  expect(
    score.purposes.flatMap((purpose) => purpose.measures.map((measure) => measure.text)),
  ).toEqual(['段階的デプロイをリハーサルで確認する。']);
  expect(run.mock.calls[1][1].messages[1].content).not.toContain(optional);
});

it('条件付きで必須の工程とMayの日付は任意工程と誤認しない', async () => {
  const action = 'Replace damaged cables before use and deliver the record by May 1.';
  const run = provider({ ...facts, actions: [sourced(action)] });
  const score = await generatePufu(env(run), context);
  expect(score.purposes[0].measures[0].text).toBe(action);
});

it.each([
  '自動処理で雨や星を消すことがあるため、結果を必ず目視で確認する。',
  '不具合が起こることがある箇所を必ず点検する。',
  'Inspect all parts that may be damaged before delivery.',
  'Always inspect records that might contain errors.',
  'Check whether the equipment may be used.',
  'Record what may have caused the failure.',
])('理由や対象に可能性が含まれる必須の主動作は残す: %s', async (action) => {
  const run = provider({ ...facts, actions: [sourced(action)] });
  const score = await generatePufu(env(run), context);
  expect(score.purposes[0].measures[0].text).toBe(action);
});

it.each([
  { source: '先行チームは研修会を実施していない。', generated: '研修会は実施しない。' },
  {
    source: 'The prior team did not run training events.',
    generated: 'Training events are out of scope.',
  },
])('過去の未実施を今回の禁止条件へ変えない: $source', async ({ source, generated }) => {
  const run = provider({
    ...facts,
    elements: { ...facts.elements, environment: [sourced(generated)] },
  });
  const score = await generatePufu(env(run), { ...context, details: source });
  expect(score.elements.environment.text).toBe('');
});

it.each(['研修会は実施しない。', 'Training events are out of scope.'])(
  '明示された現在の禁止条件は保持する: %s',
  async (condition) => {
    const run = provider({
      ...facts,
      elements: { ...facts.elements, environment: [sourced(condition)] },
    });
    const score = await generatePufu(env(run), { ...context, details: condition });
    expect(score.elements.environment.text).toBe(condition);
  },
);

it.each([
  {
    source: '先行チームは研修会を実施していない。今回は研修会を実施しない。',
    condition: '今回は研修会を実施しない。',
  },
  {
    source: 'The prior team did not run training; this project has no training planned.',
    condition: 'No training is planned.',
  },
  {
    source:
      'The prior team did not run offsite tests. External testing is forbidden for this project.',
    condition: 'External testing is prohibited.',
  },
  {
    source: '先行チームは外部試験を実施していない。今回の外部試験は認められない。',
    condition: '今回の外部試験は禁止されている。',
  },
  {
    source:
      'The prior team did not conduct offsite tests and this project rules out external testing.',
    condition: 'External testing is excluded.',
  },
  {
    source: '先行チームは外部試験を実施していないが今回は外部試験を認めない。',
    condition: '今回の外部試験は禁止されている。',
  },
])('同じ根拠区間に現在の禁止も明記されていれば保持する: $source', async ({ source, condition }) => {
  const run = provider({
    ...facts,
    elements: { ...facts.elements, environment: [sourced(condition)] },
  });
  const score = await generatePufu(env(run), { ...context, details: source });
  expect(score.elements.environment.text).toBe(condition);
});

it('成功済み抽出のキャッシュに任意工程が残っていても構成入口で除外する', async () => {
  const optional = 'ソースマスターを納品することがある。';
  const run = vi.fn<NonNullable<Env['AI']>['run']>().mockResolvedValue({
    response: JSON.stringify(plan),
  });
  const cached: PufuFacts = {
    actions: ['段階的デプロイをリハーサルで確認する。', optional],
    elements: {
      people: [],
      money: [],
      time: [],
      quality: [],
      businessScheme: [],
      environment: [],
      rival: [],
      foreignEnemy: [],
    },
  };
  const score = await arrangePufu(env(run), context, cached, 'ja');
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0][1].messages[1].content).not.toContain(optional);
  expect(score.purposes[0].measures.map((measure) => measure.text)).toEqual([
    '段階的デプロイをリハーサルで確認する。',
  ]);
});

it('選択していない個人・プロジェクトのメモリを生成AIへ送らない', async () => {
  const privateText = 'UNSELECTED-PRIVATE-KNOWLEDGE-82971';
  const memory = {
    id: 'm',
    revision: 1,
    text: privateText,
    data: {
      interests: [privateText],
      knowledge: [{ text: privateText, articleIds: ['other'] }],
      questions: [],
    },
    updated_at: '2026-11-05T00:00:00Z',
  };
  const run = provider();
  await generatePufu(env(run), { ...context, userMemory: memory, projectMemory: memory });
  expect(JSON.stringify(run.mock.calls)).not.toContain(privateText);
});

it('構成モデルは八要素の文や必須条件を追加できない', async () => {
  await expect(
    generatePufu(
      env(provider(facts, { ...plan, elements: { quality: '必ず合格する。' } })),
      context,
    ),
  ).rejects.toThrow('出力形式');
});

it('長い作業の列挙を中間目的の本文として受理しない', async () => {
  await expect(
    generatePufu(
      env(provider(facts, { ...plan, purposes: [{ text: '作業を実施する。'.repeat(12) }] })),
      context,
    ),
  ).rejects.toThrow('出力形式');
});

it('存在しない根拠を持つ事実から構成へ進まない', async () => {
  const run = provider({ ...facts, actions: [{ ...facts.actions[0], evidence: 'E999' }] });
  await expect(generatePufu(env(run), context)).rejects.toThrow('根拠');
  expect(run).toHaveBeenCalledTimes(1);
});

it('本文は抽出段階で参照し、構成段階へは抽出した短文だけを渡す', async () => {
  const run = provider();
  const title = 'タイトルだけにある将来の規格対応保証';
  await generatePufu(env(run), { ...context, stock: { ...context.stock!, title } });
  expect(run).toHaveBeenCalledTimes(2);
  const first = run.mock.calls[0][1];
  const second = run.mock.calls[1][1];
  expect(first.messages[1].content).toContain('再取り込み');
  expect(second.messages[1].content).not.toContain('再取り込み');
  expect(second.messages[1].content).not.toContain('他社');
  expect(second.messages[1].content).not.toContain(title);
  expect(second.messages[1].content).toContain('段階的デプロイをリハーサルで確認する。');
  expect(
    new TextEncoder().encode(first.messages.map((m) => m.content).join('')).length,
  ).toBeLessThanOrEqual(24000);
  expect(
    new TextEncoder().encode(second.messages.map((m) => m.content).join('')).length,
  ).toBeLessThanOrEqual(24000);
});

it('具体的な行動がない資料から勝利条件や中間目的を創作しない', async () => {
  const run = provider(
    {
      completionActions: [],
      actions: [],
      elements: {
        ...Object.fromEntries(elementKeys.map((key) => [key, []])),
        environment: [sourced('イベントは開催しない。')],
      },
    },
    { winCondition: '文書が判断に使われている。', purposes: [{ text: '準備が整っている。' }] },
  );
  const score = await generatePufu(env(run), context);
  expect(score.gainingGoal.text).toBe(context.task);
  expect(score.winCondition.text).toBe('');
  expect(score.purposes).toEqual([]);
});
