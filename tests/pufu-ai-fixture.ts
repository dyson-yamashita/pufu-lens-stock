import { vi } from 'vitest';
import type { Env } from '../server/env';
import { elementKeys } from '../shared/pufu';

type Draft = {
  gainingGoal?: string;
  winCondition: string;
  purposes: { text: string; measures: { text: string; color: string }[] }[];
  elements: Partial<Record<(typeof elementKeys)[number], string>>;
};

// API/保存のテスト用。文章の意味の正しさは実モデルによる記事との比較で検証する。
export function mockPufuAi(draft: Draft) {
  const actions = draft.purposes.flatMap((purpose) => purpose.measures);
  return vi.fn<NonNullable<Env['AI']>['run']>(async (_model, input) => {
    const jsonSchema = input.response_format?.json_schema as Record<string, unknown>;
    const schema = (jsonSchema.schema ?? jsonSchema) as { properties: Record<string, unknown> };
    if ('actions' in schema.properties) {
      const data = JSON.parse(input.messages[1].content);
      const evidence = (JSON.stringify([
        data.sources,
        data.details,
        data.question,
        data.task,
        data.project,
      ]).match(/\[(E\d+)\]/) ?? [null, 'E0'])[1];
      const fact = (text: string) => ({ evidence, scope: 'project', text });
      return {
        response: JSON.stringify({
          actions: actions.slice(0, 9).map(({ text }) => fact(text)),
          completionActions: actions.slice(9).map(({ text }) => fact(text)),
          elements: Object.fromEntries(
            elementKeys.map((key) => [key, draft.elements[key] ? [fact(draft.elements[key])] : []]),
          ),
        }),
      };
    }
    const data = JSON.parse(input.messages[1].content) as {
      actionGroups: { purpose: number; actions: string[] }[];
    };
    return {
      response: JSON.stringify({
        ...(draft.gainingGoal ? { gainingGoal: draft.gainingGoal } : {}),
        winCondition: draft.winCondition,
        purposes: data.actionGroups.length
          ? data.actionGroups.map((_, index) => ({
              text:
                draft.purposes[Math.min(index, draft.purposes.length - 1)]?.text ??
                draft.winCondition,
            }))
          : draft.purposes.map(({ text }) => ({ text })),
      }),
    };
  });
}
