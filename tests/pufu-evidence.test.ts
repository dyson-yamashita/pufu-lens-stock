import { expect, it } from 'vitest';
import { prepareEvidenceInput } from '../server/pufu-evidence';
import { generationInput } from '../server/pufu-grounding';
import type { PufuContext } from '../shared/pufu';

const context: PufuContext = {
  task: '成果物',
  project: { id: 'p', name: '計画', description: '' },
  question: null,
  userMemory: null,
  projectMemory: null,
  stock: { id: 's', title: '本文', note: '', summary: null, content: '' },
};

it('切断区間は文単位で除き、同じ段落の完全な文は根拠に使える', () => {
  const input = generationInput(context, 30000);
  input.sources = [
    {
      id: 'article:0:0',
      kind: 'article',
      text: '途中文。完全な条件がある。終端の断片',
      clippedStart: true,
      clippedEnd: true,
    },
  ];
  const prepared = prepareEvidenceInput(input);
  expect([...prepared.sources.values()]).toEqual(['成果物', '完全な条件がある。']);
  expect(prepared.input.sources[0].text).toContain('[partial]\n途中文。');
  expect(prepared.input.sources[0].text).toContain('終端の断片');
});

it('長い段落も文ごとに分け、別の対象の条件を一つの根拠へ混在させない', () => {
  const input = generationInput(
    {
      ...context,
      stock: {
        ...context.stock!,
        content: '映像には手を加えない。音声は方針に応じてサラウンド化する。',
      },
    },
    30000,
  );
  const prepared = prepareEvidenceInput(input);
  expect([...prepared.sources.values()]).toEqual([
    '成果物',
    '映像には手を加えない。',
    '音声は方針に応じてサラウンド化する。',
  ]);
});

it('多数の短い行でも本文を保持し、ラベルの追加は1KiB以内に収める', () => {
  const body = '条件。\n'.repeat(3000);
  const input = generationInput({ ...context, stock: { ...context.stock!, content: body } }, 40000);
  const prepared = prepareEvidenceInput(input);
  expect(prepared.input.sources[0].text.replace(/\[E\d+\]\n/g, '').replace(/\s/g, '')).toBe(
    body.replace(/\s/g, ''),
  );
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
  expect(bytes(prepared.input) - bytes(input)).toBeLessThanOrEqual(1024);
  expect(prepared.sources.size).toBeLessThanOrEqual(85);
});

it('改行のない多数の短文でも、文間へ改行を増殖させず入力枠を保持する', () => {
  const input = generationInput(
    { ...context, stock: { ...context.stock!, content: '条件。'.repeat(6000) } },
    33000,
  );
  const prepared = prepareEvidenceInput(input);
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
  expect(bytes(prepared.input) - bytes(input)).toBeLessThanOrEqual(1024);
  expect(
    prepared.input.sources
      .map((source) => source.text)
      .join('')
      .replace(/\[E\d+\]\n|\[partial\]\n|\s/g, ''),
  ).toBe(
    input.sources
      .map((source) => source.text)
      .join('')
      .replace(/\s/g, ''),
  );
});

it('切り詰めたプロジェクト説明は根拠IDを付けず背景として保持する', () => {
  const input = generationInput(
    { ...context, project: { ...context.project, description: '説明'.repeat(1000) } },
    30000,
  );
  const prepared = prepareEvidenceInput(input, false);
  expect(prepared.input.project.description).toMatch(/^\[partial\]/);
  expect([...prepared.sources.values()]).not.toContain(input.project.description);
});

it('要約は背景として保持し、有効な根拠IDを付けない', () => {
  const input = generationInput(context, 30000);
  input.sources = [{ id: 'summary:0', kind: 'summary', text: '要約の途中で切れた条件' }];
  const prepared = prepareEvidenceInput(input);
  expect([...prepared.sources.values()]).not.toContain(input.sources[0].text);
  expect(prepared.input.sources[0].text).toBe('[background]\n要約の途中で切れた条件');
});
