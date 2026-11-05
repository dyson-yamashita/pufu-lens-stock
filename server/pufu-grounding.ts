import { z } from 'zod';
import type { PufuContext } from '../shared/pufu';
import { elementKeys } from '../shared/pufu';
import { excerptParts } from './pufu-context';

// ノード本文は引用ではなく、資料を整理した短い文章を受け取る。
const text = z.string().trim().min(1).max(240);
export const pufuDraftSchema = z.strictObject({
  winCondition: text,
  purposes: z
    .array(
      z.strictObject({
        text,
        measures: z
          .array(
            z.strictObject({ text, color: z.enum(['white', 'blue', 'green', 'red', 'yellow']) }),
          )
          .max(3),
      }),
    )
    .max(4),
  elements: z.strictObject(
    Object.fromEntries(elementKeys.map((key) => [key, z.string().trim().max(240)])) as Record<
      (typeof elementKeys)[number],
      z.ZodString
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
