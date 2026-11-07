import { expect, it } from 'vitest';
import { generatePufu } from '../server/pufu';
import { normalizeGeneratedScore } from '../server/pufu-output';
import { elementKeys, type PufuContext } from '../shared/pufu';
import type { Env } from '../server/env';
import { mockPufuAi, reviewDraft } from './pufu-ai-fixture';

const win = '依頼者が、合意方針に沿って映像・音声を復元したマスターを各用途で利用できる。';
const context: PufuContext = {
  task: 'サンプル作品の修復版',
  details:
    '方針と素材を決める。映像を修復して目視で確認する。音声を修復して上映用データを納品する。',
  project: { id: 'p', name: 'サンプル', description: '' },
  stock: null,
  question: null,
  userMemory: null,
  projectMemory: null,
};
const draft = {
  winCondition: win,
  purposes: [
    {
      text: '方針と素材が確定している。',
      measures: [{ text: '方針と素材を決める。', color: 'white' }],
    },
    {
      text: '映像が修復されている。',
      measures: [{ text: '映像を修復して目視で確認する。', color: 'white' }],
    },
    {
      text: '音声と上映用データが整っている。',
      measures: [{ text: '音声を修復して上映用データを納品する。', color: 'white' }],
    },
  ],
  elements: { quality: '合意した表現方針を維持する。' },
};
function provider(issues: string[][] = [[]], wins = [win]) {
  const ai = mockPufuAi(draft);
  const base = ai.getMockImplementation()!;
  let generations = 0;
  let reviews = 0;
  ai.mockImplementation(async (model, input) => {
    const data = JSON.parse(input.messages[1].content);
    if ('winCondition' in data) {
      const reasons = issues[Math.min(reviews++, issues.length - 1)];
      return {
        response: JSON.stringify({
          ...reviewDraft(data, reasons),
          purposeChecks: data.purposes.map((p: { purpose: number }) => ({
            purpose: p.purpose,
            integrated: !reasons.length,
          })),
          elementChecks: Object.fromEntries(elementKeys.map((k) => [k, true])),
          grounded: !reasons.length,
          wholeSituation: !reasons.length,
          issues: reasons,
        }),
      };
    }
    const response = await base(model, input);
    if ('purposes' in data && !('actionGroups' in data)) {
      const value = JSON.parse((response as { response: string }).response);
      value.winCondition = wins[Math.min(generations++, wins.length - 1)];
      return { response: JSON.stringify(value) };
    }
    return response;
  });
  return ai;
}
const env = (run: NonNullable<Env['AI']>['run']) =>
  ({ AI: { run }, AI_MODEL: 'test' }) as unknown as Env;

it('正当な利用成果を語句だけで定型文へ置換せず、最終文を別呼び出しで検証する', async () => {
  const ai = provider();
  const score = await generatePufu(env(ai), context);
  expect(score.winCondition.text).toBe(win);
  expect(ai).toHaveBeenCalledTimes(4);
  const review = JSON.parse(ai.mock.calls[3][1].messages[1].content);
  expect(review.winCondition).toBe(score.winCondition.text);
  expect(normalizeGeneratedScore(score, context).winCondition.text).toBe(win);
});

it('内容の不合格理由を使って勝利条件だけを1回再生成する', async () => {
  const ai = provider([['修復の成果が表現されていない。'], []], ['確認結果が得られている。', win]);
  const score = await generatePufu(env(ai), context);
  expect(score.winCondition.text).toBe(win);
  expect(ai).toHaveBeenCalledTimes(6);
  const prompts = ai.mock.calls.map(([, input]) => JSON.parse(input.messages[1].content));
  expect(prompts.filter((p) => 'sources' in p)).toHaveLength(1);
  expect(prompts.filter((p) => 'actionGroups' in p)).toHaveLength(1);
  expect(prompts[4].revision).toEqual({
    winCondition: '確認結果が得られている。',
    issues: ['修復の成果が表現されていない。'],
  });
});

it('再検証も不合格なら定型文を成功結果として返さない', async () => {
  const ai = provider([['全体の成就を表していない。']], ['確認結果が得られている。']);
  await expect(generatePufu(env(ai), context)).rejects.toThrow('勝利条件');
  expect(ai).toHaveBeenCalledTimes(6);
});

it.each(['purpose', 'element', 'reason'] as const)(
  '独立検証の%sが不正なら受理しない',
  async (kind) => {
    const ai = provider();
    const base = ai.getMockImplementation()!;
    ai.mockImplementation(async (model, input) => {
      const data = JSON.parse(input.messages[1].content);
      if (!('winCondition' in data)) return base(model, input);
      const review = reviewDraft(data);
      if (kind === 'purpose') review.purposeChecks[1].purpose = 1;
      if (kind === 'element') delete (review.elementChecks as Record<string, boolean>).quality;
      if (kind === 'reason') review.grounded = false;
      return { response: JSON.stringify(review) };
    });
    await expect(generatePufu(env(ai), context)).rejects.toThrow();
    expect(ai).toHaveBeenCalledTimes(4);
  },
);

it.each(['article', 'note', 'project'] as const)(
  '抽出から落ちた%sの留保も独立検証へ渡す',
  async (location) => {
    const condition = '修復後に利用できるかは未確認であり、利用可能とは保証しない。';
    const stock = {
      id: 's',
      title: '架空の修復資料',
      note: location === 'note' ? condition : '',
      summary: null,
      content: context.details! + (location === 'article' ? condition : ''),
    };
    const c = {
      ...context,
      stock,
      project: { ...context.project, description: location === 'project' ? condition : '' },
    };
    const ai = provider();
    await generatePufu(env(ai), c);
    const review = JSON.parse(ai.mock.calls[3][1].messages[1].content);
    expect(review.sourceEvidence).toBeDefined();
    expect(JSON.stringify(review.sourceEvidence)).toContain(condition);
    expect(review.sourceEvidence.userMemory).toBeNull();
    expect(review.sourceEvidence.projectMemory).toBeNull();
    expect(review.sourceEvidence.task).toBe('');
  },
);

it('長い原資料は抜粋を明示し、検証の24KB入力上限を守る', async () => {
  const ai = provider();
  await generatePufu(env(ai), {
    ...context,
    stock: {
      id: 's',
      title: '架空の長文資料',
      note: '',
      summary: null,
      content: '前提条件を検討する。'.repeat(2000),
    },
  });
  const review = ai.mock.calls[3][1];
  expect(
    new TextEncoder().encode(review.messages.map((m) => m.content).join('')).length,
  ).toBeLessThanOrEqual(24000);
  expect(JSON.parse(review.messages[1].content).sourceEvidence.stocks[0].contentExcerpted).toBe(
    true,
  );
});
