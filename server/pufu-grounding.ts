import { z } from 'zod';
import type { PufuContext } from '../shared/pufu';
import { elementKeys } from '../shared/pufu';
import { excerptParts } from './pufu-context';

export const sourceQuote = z.strictObject({
  sourceId: z.string().min(1).max(100),
  quote: z.string().trim().min(1).max(1100),
});
const text = z.string().trim().min(1).max(1200);
export const groundedDraftSchema = z.strictObject({
  winCondition: text,
  purposes: z
    .array(
      z.strictObject({
        text,
        measures: z
          .array(sourceQuote.extend({ color: z.enum(['white', 'blue', 'green', 'red', 'yellow']) }))
          .max(4),
      }),
    )
    .max(5),
  elements: z.strictObject(
    Object.fromEntries(elementKeys.map((key) => [key, sourceQuote.nullable()])) as Record<
      (typeof elementKeys)[number],
      z.ZodNullable<typeof sourceQuote>
    >,
  ),
});
export type PufuSource = {
  id: string;
  kind: 'article' | 'note' | 'summary';
  text: string;
  clippedStart?: boolean;
  clippedEnd?: boolean;
};
export function generationInput(context: PufuContext, byteBudget: number) {
  const stocks = (context.stocks ?? (context.stock ? [context.stock] : [])).slice(0, 1);
  const question = context.questions?.[0] ?? context.question;
  const memory = (value: PufuContext['userMemory'], limit: number) =>
    value && limit > 0
      ? {
          revision: value.revision,
          data: {
            interests: value.data.interests
              .slice(0, 2)
              .map((text) => text.slice(0, Math.min(100, limit))),
            knowledge: value.data.knowledge
              .slice(0, 2)
              .map(({ text }) => ({ text: text.slice(0, Math.min(300, limit)) })),
            questions: value.data.questions
              .slice(0, 2)
              .map((text) => text.slice(0, Math.min(100, limit))),
          },
        }
      : null;
  const make = (limit: number) => ({
    task: context.task,
    details: context.details ?? '',
    project: {
      name: context.project.name.slice(0, 200),
      description: context.project.description.slice(0, Math.min(300, limit)),
    },
    question: question ? { text: question.text, source: question.source } : null,
    stocks: stocks.map((stock) => ({
      title: stock.title.slice(0, 200),
      contentIncomplete: stock.contentIncomplete ?? false,
      contentExcerpted: stock.contentExcerpted ?? false,
    })),
    sources: stocks.flatMap((stock, index): PufuSource[] => [
      ...excerptParts(stock.content ?? '', limit * 4).map((text, part, parts) => ({
        id: `article:${index}:${part}`,
        kind: 'article' as const,
        text,
        ...(part > 0 ? { clippedStart: true } : {}),
        ...(part < parts.length - 1 ? { clippedEnd: true } : {}),
      })),
      ...(stock.note && limit
        ? [
            {
              id: `note:${index}`,
              kind: 'note' as const,
              text: stock.note.slice(0, limit),
              ...(stock.note.length > limit ? { clippedEnd: true } : {}),
            },
          ]
        : []),
      ...(!stock.content && stock.summary && limit
        ? [
            {
              id: `summary:${index}`,
              kind: 'summary' as const,
              text: stock.summary.overview.slice(0, limit),
            },
          ]
        : []),
    ]),
    userMemory: memory(context.userMemory, Math.floor(limit / 10)),
    projectMemory: memory(context.projectMemory, Math.floor(limit / 10)),
  });
  const size = (value: ReturnType<typeof make>) =>
    new TextEncoder().encode(JSON.stringify(value)).length;
  if (size(make(0)) > byteBudget) throw new Error('プ譜の明示条件が入力上限を超えています。');
  let low = 0,
    high = 20000;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (size(make(middle)) <= byteBudget) low = middle;
    else high = middle - 1;
  }
  const result = make(low);
  if (stocks[0]?.content && !result.sources.some((source) => source.kind === 'article'))
    throw new Error('本文の参照に必要な入力枠がありません。補足を短くしてください。');
  return result;
}
export function resolveQuote(
  value: z.infer<typeof sourceQuote> | null,
  input: ReturnType<typeof generationInput>,
): { text: string; kind: 'input' | 'question' | PufuSource['kind']; label: string } | null {
  if (!value) return null;
  const fixed = [
    { id: 'task', text: input.task, kind: 'input' as const, label: '獲得目標の入力' },
    { id: 'details', text: input.details, kind: 'input' as const, label: '補足の入力' },
    { id: 'question', text: input.question?.text ?? '', kind: 'question' as const, label: '問い' },
  ];
  const source = [...fixed, ...input.sources].find((source) => source.id === value.sourceId);
  // 抜粋は別々の資料。省略した区間をまたぐ「引用」は一致させない。
  if (!source || source.kind === 'summary' || !source.text.includes(value.quote)) return null;
  const sentences = Array.from(
    new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(source.text),
    (part) => part.segment.trim(),
  );
  const paragraphs = source.text
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  // 切断された断片をSegmenterが一文と認定しても、原文の完全な文とは扱わない。
  if ('clippedStart' in source && source.clippedStart) {
    sentences.shift();
    paragraphs.shift();
  }
  if ('clippedEnd' in source && source.clippedEnd) {
    sentences.pop();
    paragraphs.pop();
  }
  if (!sentences.includes(value.quote) && !paragraphs.includes(value.quote)) return null;
  return {
    text: value.quote,
    kind: source.kind,
    label: 'label' in source ? source.label : (input.stocks[0]?.title ?? 'ストック'),
  };
}
