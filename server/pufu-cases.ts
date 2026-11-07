import { z } from 'zod';
import { type PufuContext } from '../shared/pufu';
import type { Language } from '../shared/locale';

// 主要事例は通常工程の件数枠とは別に保持する。対象名と時制を落とさない。
const namedFact = z.strictObject({
  evidence: z.string().regex(/^E\d+$/),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .describe(
      '原文にある対象の固有名称だけ。括弧や工程名は含めない。 / Exact proper name from the evidence, without quotation marks or process labels.',
    ),
  text: z.string().trim().min(1).max(80),
  kind: z.enum(['actual', 'option', 'capability', 'possibility', 'background']),
});
const oneCase = z.array(namedFact).max(1);
export const pufuCasesSchema = z.strictObject({
  materials: oneCase.describe(
    '主要事例の既存素材・設備。撮影フィルム等。 / Actual materials or equipment of a central example.',
  ),
  decisions: oneCase.describe(
    '主要事例の品質上の選択と判断理由・損失リスク。 / Actual quality decisions with their reasons or tradeoffs.',
  ),
  processing: z
    .array(namedFact.extend({ actionIndex: z.number().int().min(0).max(11) }))
    .max(1)
    .describe(
      '主要事例で実際に行った具体的処理。同じ処理の通常工程番号を選ぶ。 / Actual processing in a central example with its matching action index.',
    ),
});
export type PufuCase = z.infer<typeof namedFact> & { placement: string };

export function caseActionIndex(value: PufuCase) {
  return value.placement.startsWith('action:') ? Number(value.placement.slice(7)) : null;
}

export function articleReconstruction(context: PufuContext) {
  return !context.task.trim() && !(context.questions?.[0]?.text ?? context.question?.text)?.trim();
}

export function caseText(value: PufuCase, language: Language) {
  return language === 'ja'
    ? `${/^[「『]/u.test(value.subject) ? value.subject : `「${value.subject}」`}では、${value.text}`
    : `${value.subject}: ${value.text}`;
}

// 完全文のまま上限に収める。事例を優先し、条件を途中で切って意味を変えない。
export function elementWithCases(
  base: string[],
  cases: PufuCase[],
  language: Language,
  conditions: string[] = [],
) {
  const selected = [...new Set(conditions)];
  if (selected.join(' ').length > 240)
    throw new Error('重要な条件が表示上限を超えています。資料を短くしてください。');
  for (const value of [...cases.map((value) => caseText(value, language)), ...base]) {
    if (!selected.includes(value) && [...selected, value].join(' ').length <= 240)
      selected.push(value);
  }
  return selected.join(' ');
}
