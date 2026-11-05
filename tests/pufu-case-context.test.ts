import { expect, it, vi } from 'vitest';
import { generatePufu } from '../server/pufu';
import { elementKeys, type PufuContext } from '../shared/pufu';
import type { Env } from '../server/env';

const subject = 'サンプル作品';
const context: PufuContext = {
  task: '',
  question: null,
  userMemory: null,
  projectMemory: null,
  project: { id: 'p', name: 'サンプル', description: '' },
  stock: {
    id: 's',
    title: '「サンプル作品」で学ぶリマスター技術',
    note: '',
    summary: null,
    content:
      '作品側と方針を相談する。音声のノイズを除去する。データを納品する。サンプル作品は35ミリ撮影。サンプル作品ではグラデーションが減る可能性を説明し、フィルムらしさを残した。サンプル作品はセリフを分離してサラウンド化した。',
  },
};
const fact = (text: string) => ({ evidence: 'E0', scope: 'project', text });
const cases = [
  {
    evidence: 'E0',
    subject,
    text: '35ミリフィルムで撮影された。',
    kind: 'actual',
    placement: 'environment',
  },
  {
    evidence: 'E0',
    subject,
    text: 'グラデーションが減る可能性を説明し、フィルムらしさを残した。',
    kind: 'actual',
    placement: 'quality',
  },
  {
    evidence: 'E0',
    subject,
    text: 'セリフを分離してサラウンド化した。',
    kind: 'actual',
    placement: 'action:1',
  },
];
function setup(
  caseFacts: unknown[] = cases,
  options: { firstScope?: string; secondAction?: string; quality?: string[] } = {},
) {
  const run = vi.fn<NonNullable<Env['AI']>['run']>().mockImplementation(async (_model, input) => {
    const data = JSON.parse(input.messages[1].content);
    if ('sources' in data) {
      const evidence = data.sources[0].text.match(/\[(E\d+)\]/)[1];
      return {
        response: JSON.stringify({
          actions: ['作品側と方針を相談する。', options.secondAction ?? '音声のノイズを除去する。']
            .map(fact)
            .map((f, index) => ({
              ...f,
              evidence,
              scope: index === 0 ? (options.firstScope ?? 'project') : 'project',
            })),
          completionActions: [{ ...fact('データを納品する。'), evidence }],
          elements: Object.fromEntries(
            elementKeys.map((k) => [
              k,
              k === 'quality'
                ? (options.quality ?? ['作品ごとに合意した方針を守る。']).map((text) => ({
                    ...fact(text),
                    evidence,
                  }))
                : [],
            ]),
          ),
          cases: Object.fromEntries(
            ['materials', 'decisions', 'processing'].map((slot) => [
              slot,
              caseFacts
                .filter((c) => {
                  const v = c as (typeof cases)[number];
                  return slot === 'materials'
                    ? v.placement === 'environment'
                    : slot === 'decisions'
                      ? v.placement === 'quality'
                      : v.placement.startsWith('action:');
                })
                .map((c) => {
                  const value = c as (typeof cases)[number];
                  const term =
                    value.placement === 'environment'
                      ? '35ミリ'
                      : value.placement === 'quality'
                        ? 'グラデーション'
                        : 'サラウンド';
                  const units = data.sources[0].text.split(/(?=\[E\d+\])/);
                  const id = (units.find(
                    (s: string) => s.includes(term) && s.includes(value.subject),
                  ) ?? units.find((s: string) => s.includes(term)))!.match(/\[(E\d+)\]/)![1];
                  const { placement, ...rest } = value;
                  return {
                    ...rest,
                    ...(slot === 'processing' ? { actionIndex: Number(placement.slice(7)) } : {}),
                    evidence: value.evidence === 'E99' ? 'E99' : id,
                  };
                }),
            ]),
          ),
        }),
      };
    }
    return {
      response: JSON.stringify({
        ...(!data.task ? { gainingGoal: 'リマスター映像' } : {}),
        winCondition: '合意した方針に沿う映像が用途別に整っている。',
        purposes: data.actionGroups.map(() => ({ text: '工程の結果が得られている。' })),
      }),
    };
  });
  return { run, env: { AI: { run }, AI_MODEL: 'test' } as unknown as Env };
}

it('主要事例の素材・判断理由・具体的処理を対象付きで保存し、記事と品質情報を構成へ渡す', async () => {
  const { run, env } = setup();
  const score = await generatePufu(env, context);
  expect(score.elements.environment.text).toContain(subject);
  expect(score.elements.environment.text).toContain('35ミリ');
  expect(score.elements.quality.text).toContain('可能性');
  expect(score.elements.quality.text).toContain(subject);
  const measures = score.purposes.flatMap((p) => p.measures.map((m) => m.text));
  expect(measures).toHaveLength(3);
  expect(measures[1]).toContain(`${subject}`);
  expect(measures[1]).toContain('サラウンド化した');
  expect(measures[2]).toBe('データを納品する。');
  const second = JSON.parse(run.mock.calls[1][1].messages[1].content);
  expect(second.sourceTitle).toBe(context.stock!.title);
  expect(JSON.stringify(second.centralCases)).toContain('フィルムらしさ');
  expect(JSON.stringify(second.actionGroups)).not.toContain('サラウンド');
  expect(JSON.stringify(second.qualityConditions)).not.toContain('フィルムらしさ');
  expect(run).toHaveBeenCalledTimes(2);
});

it('独自の目標や問いがある場合、記事の事例を利用者の施策・素材条件に転用しない', async () => {
  for (const explicit of [
    { task: '自分の修復手順書' },
    { question: { id: 'q', source: 'user' as const, text: '自分の作品の修復にどう活かすか' } },
  ]) {
    const { env } = setup();
    const score = await generatePufu(env, { ...context, ...explicit });
    expect(JSON.stringify(score)).not.toMatch(/35ミリ|サラウンド|サンプル作品/);
    if ('task' in explicit) expect(score.gainingGoal.text).toBe(explicit.task);
  }
});

it.each(['option', 'capability', 'possibility', 'background'])(
  '主要事例の枠でも%sを実施済みの事実へ変えない',
  async (kind) => {
    const { env } = setup(cases.map((c) => ({ ...c, kind })));
    const score = await generatePufu(env, context);
    expect(JSON.stringify(score)).not.toMatch(/35ミリ|サラウンド|サンプル作品/);
  },
);

it.each([
  { ...cases[0], evidence: 'E99' },
  { ...cases[0], subject: '存在しない作品' },
  { ...cases[2], placement: 'action:9' },
])('根拠・対象・配置先を確認できない事例を拒否する: %j', async (invalid) => {
  const { env } = setup([invalid]);
  await expect(generatePufu(env, context)).rejects.toThrow();
});

it('採用されなかった前工程があっても事例の対応工程番号を保つ', async () => {
  const { env } = setup(cases, { firstScope: 'option' });
  const score = await generatePufu(env, context);
  const measures = score.purposes.flatMap((p) => p.measures.map((m) => m.text));
  expect(measures).toHaveLength(2);
  expect(measures[0]).toContain('音声のノイズ');
  expect(measures[0]).toContain('サラウンド化した');
  expect(measures[1]).toBe('データを納品する。');
});

it('任意工程に事例が付いていても必須工程として復活させない', async () => {
  const { env } = setup(cases, { secondAction: '音声をサラウンド化することもある。' });
  const score = await generatePufu(env, context);
  expect(
    score.purposes
      .flatMap((p) => p.measures)
      .map((m) => m.text)
      .join(' '),
  ).not.toContain('サラウンド');
});

it('事例と一般条件が長い場合も条件文を切らず上限内で保持する', async () => {
  const quality = ['条件A。'.repeat(27), '条件B。'.repeat(27)];
  const { env } = setup(cases, { quality });
  const score = await generatePufu(env, context);
  expect(score.elements.quality.text.length).toBeLessThanOrEqual(240);
  expect(score.elements.quality.text).toContain('フィルムらしさを残した。');
  expect(score.elements.quality.text).toContain(quality[0]);
  expect(score.elements.quality.text).not.toContain('条件B');
});

it('根拠に存在する版の限定は対象名の正規化でも維持する', async () => {
  const { env } = setup([
    { ...cases[0], subject: '「サンプル作品」のDVD版', text: 'SD素材だった。' },
  ]);
  const score = await generatePufu(env, {
    ...context,
    stock: {
      ...context.stock!,
      content: context.stock!.content + '\n「サンプル作品」のDVD版は35ミリではなくSD素材だった。',
    },
  });
  expect(score.elements.environment.text).toContain('「サンプル作品」のDVD版では、SD素材だった。');
});

it('原文にない見出しは実在する引用符内の名称へ戻し、未知の版限定は捨てて広げない', async () => {
  const named = setup([{ ...cases[0], subject: '「サンプル作品」のフィルム素材' }]);
  expect((await generatePufu(named.env, context)).elements.environment.text).toContain(
    '「サンプル作品」では、35ミリ',
  );
  const invalid = setup([{ ...cases[0], subject: '「サンプル作品」の未確認版' }]);
  await expect(generatePufu(invalid.env, context)).rejects.toThrow('主要事例');
  const prefixed = setup([{ ...cases[0], subject: 'DVD版「サンプル作品」の素材条件' }]);
  await expect(generatePufu(prefixed.env, context)).rejects.toThrow('主要事例');
});

it('採用しない背景の見出しや配置番号を検証して独自計画の生成を停止しない', async () => {
  const { env } = setup([
    { ...cases[0], subject: '記事の素材条件という見出し', kind: 'background' },
  ]);
  const score = await generatePufu(env, { ...context, task: '自分の修復手順書' });
  expect(score.gainingGoal.text).toBe('自分の修復手順書');
  expect(score.elements.environment.text).toBe('');
});
