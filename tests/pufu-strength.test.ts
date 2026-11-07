import { expect, it } from 'vitest';
import { unsupportedPufuStrength } from '../server/pufu-semantic-checks';
import type { PufuContext } from '../shared/pufu';
const context = (details: string): PufuContext => ({
  task: '資料を整理する',
  details,
  project: { id: 'p', name: '資料', description: '' },
  stock: null,
  question: null,
  userMemory: null,
  projectMemory: null,
});
it.each([
  ['重複を確認し、一覧を保存する。', '重複排除した一覧が保存されている。'],
  ['誤検出がないか目視で確認する。', '目視確認で誤検出を排除した状態。'],
  ['Inspect records for duplicates.', 'The records have been deduplicated.'],
  ['重複は削除しない。重複を確認する。', '重複を削除した一覧が整っている。'],
])('確認や不実施を排除の達成へ強めない: %s', (source, candidate) => {
  expect(unsupportedPufuStrength(context(source), candidate).length).toBeGreaterThan(0);
});
it.each([
  ['重複を確認し、重複した記録を取り除いて一覧を保存する。', '重複のない一覧が保存されている。'],
  [
    'Inspect duplicates and save a report.',
    'The report records duplicates; deduplication is not required.',
  ],
  ['重複を確認し、重複した記録を削除し、一覧を保存する。', '重複のない一覧が保存されている。'],
  ['重複を確認して保存する。', '重複排除は行わず、確認した一覧が保存されている。'],
  [
    'Check for duplicates and save the report.',
    'The report is saved without eliminating duplicates.',
  ],
  ['一覧を保存する。', '重複排除した一覧が保存されている。'],
  ['重複は削除しない。重複を確認して保存する。', '重複を削除せず、確認した一覧が保存されている。'],
  ['重複を削除して一覧を保存する。', '重複排除した一覧が保存されている。'],
  ['Remove duplicate copies and save the records.', 'The records have been deduplicated.'],
  ['原本は削除しないが、複製の重複を除去する。', '重複を除去した複製が保存されている。'],
])('資料に明示された除去まで禁止しない: %s', (source, candidate) => {
  expect(unsupportedPufuStrength(context(source), candidate)).toEqual([]);
});

it('旧形式の合格キャッシュを再利用して意味検証を迂回しない', async () => {
  const { generatePufu } = await import('../server/pufu');
  const { mockPufuAi } = await import('./pufu-ai-fixture');
  const candidate = '重複排除した一覧が保存されている。';
  const run = mockPufuAi({
    winCondition: candidate,
    purposes: [
      {
        text: '一覧の確認結果が得られている。',
        measures: [{ text: '重複を確認する。', color: 'white' }],
      },
    ],
    elements: {},
  });
  const ctx = context('重複を確認して一覧を保存する。');
  const env = { AI: { run }, AI_MODEL: 'test' } as unknown as import('../server/env').Env;
  await expect(
    generatePufu(env, ctx, 'ja', async (name, operation) => {
      if (name === 'review-pufu-win-v1')
        return JSON.parse(JSON.stringify({ winCondition: candidate, issues: [] }));
      return operation(ctx);
    }),
  ).rejects.toThrow('勝利条件');
});
