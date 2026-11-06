import { expect, it, vi } from 'vitest';
import { generatePufu } from '../server/pufu';
import { elementKeys, type PufuContext } from '../shared/pufu';
import type { Env } from '../server/env';

const context: PufuContext = {
  task: 'サンプル作品の修復映像',
  question: null,
  stock: null,
  details: '素材を選ぶ。映像と音声を修復する。用途別のデータを作る。',
  project: { id: 'p', name: 'サンプル', description: '' },
  userMemory: null,
  projectMemory: null,
};
const elements = Object.fromEntries(
  elementKeys.map((key) => [
    key,
    [key === 'time' ? '例示作品では3カ月程度かかる。' : `${key}の既知条件。`],
  ]),
);
const purposes = [
  '必要な素材が用意されている。',
  '映像と音声の修復結果が得られている。',
  '用途別のデータが揃っている。',
];
function provider(
  options: {
    links?: number[];
    missingElement?: boolean;
    unsupported?: boolean;
    crossField?: boolean;
  } = {},
) {
  return vi.fn<NonNullable<Env['AI']>['run']>().mockImplementation(async (_model, input) => {
    const data = JSON.parse(input.messages[1].content);
    if ('sources' in data)
      return {
        response: JSON.stringify({
          actions: context
            .details!.split('。')
            .filter(Boolean)
            .map((text) => ({ text, evidence: 'E1', scope: 'project' })),
          completionActions: [],
          elements: Object.fromEntries(
            elementKeys.map((key) => [
              key,
              (options.crossField && key === 'quality'
                ? elements.time
                : (options.unsupported || options.crossField) && key === 'time'
                  ? []
                  : elements[key]
              ).map((text) => ({ text, evidence: 'E1', scope: 'project' })),
            ]),
          ),
        }),
      };
    if ('actionGroups' in data)
      return { response: JSON.stringify({ purposes: purposes.map((text) => ({ text })) }) };
    return {
      response: JSON.stringify({
        contributions: (options.links ?? [1, 2, 3]).map((purpose) => ({
          purpose,
          text: purposes[purpose - 1],
        })),
        elementConsiderations: Object.fromEntries(
          elementKeys
            .filter((key) => !options.missingElement || key !== 'time')
            .map((key) => [
              key,
              {
                role: 'constraint',
                sourceElements: [options.crossField && key === 'time' ? 'quality' : key],
              },
            ]),
        ),
        winCondition: '作品の表現方針に沿う映像と音声が修復され、用途に応じた形で提供できている。',
      }),
    };
  });
}

it('全中間目的を確定してから八要素全項目とともに勝利条件へ統合する', async () => {
  const run = provider();
  const score = await generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, context);
  expect(run).toHaveBeenCalledTimes(3);
  expect(JSON.parse(run.mock.calls[1][1].messages[1].content).elements).toEqual(elements);
  const finalInput = JSON.parse(run.mock.calls[2][1].messages[1].content);
  expect(finalInput.purposes.map((p: { text: string }) => p.text)).toEqual(purposes);
  expect(finalInput.elements).toEqual(elements);
  expect(score.winCondition.text).toContain('映像と音声');
  expect(JSON.stringify(score)).not.toMatch(/contributions|elementConsiderations/);
});

it.each([
  [1, 2],
  [1, 1, 3],
  [1, 2, 4],
])('中間目的の寄与が欠落・重複した統合を受理しない: %j', async (...links) => {
  const run = provider({ links });
  await expect(
    generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, context),
  ).rejects.toThrow();
});

it('八要素の考慮漏れを受理しない', async () => {
  const run = provider({ missingElement: true });
  await expect(
    generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, context),
  ).rejects.toThrow();
});

it('空の入力を根拠にした八要素の評価を受理しない', async () => {
  const run = provider({ unsupported: true });
  await expect(
    generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, context),
  ).rejects.toThrow('根拠');
});

it('条件が別の要素へ混ざっていても実在する項目を参照して考慮できる', async () => {
  const run = provider({ crossField: true });
  const score = await generatePufu({ AI: { run }, AI_MODEL: 'test' } as unknown as Env, context);
  expect(score.winCondition.text).toContain('映像と音声');
});
