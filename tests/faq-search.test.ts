import { expect, it } from 'vitest';
import { faqCategories, searchFaq } from '../shared/faq';

const ids = (query: string, language: 'ja' | 'en' = 'ja') =>
  searchFaq(faqCategories(language), query).flatMap((category) =>
    category.entries.map((entry) => entry.id),
  );

it.each([
  ['誰が運営', 'ja', ['operator']],
  ['Safari', 'ja', ['devices']],
  ['  ｍｃｐ　無料  ', 'ja', ['free']],
  ['ＭＣＰ　ＦＲＥＥ', 'en', ['free']],
  ['haluworks.com', 'ja', ['contact']],
  ['.*', 'ja', []],
  ['存在しないキーワード', 'ja', []],
] as const)('質問・回答を検索する: %s (%s)', (query, language, expected) => {
  expect(ids(query, language)).toEqual(expected);
});

it('空白だけなら全件を表示し、カテゴリ名でも絞り込める', () => {
  expect(ids('  \u3000 ')).toHaveLength(28);
  expect(searchFaq(faqCategories('ja'), '料金・利用制限').map((category) => category.id)).toEqual([
    'pricing',
  ]);
});
