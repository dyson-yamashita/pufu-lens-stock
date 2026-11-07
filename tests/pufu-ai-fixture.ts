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
export function mockPufuAi(draft: Draft, reviewIssues: string[] = []) {
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
          conditions: [],
          actions: actions.slice(0, 9).map(({ text }) => fact(text)),
          completionActions: actions.slice(9).map(({ text }) => fact(text)),
          elements: Object.fromEntries(
            elementKeys.map((key) => [key, draft.elements[key] ? [fact(draft.elements[key])] : []]),
          ),
        }),
      };
    }
    const raw = JSON.parse(input.messages[1].content);
    if ('winCondition' in raw) return { response: JSON.stringify(reviewDraft(raw, reviewIssues)) };
    if (!('actionGroups' in raw))
      return { response: JSON.stringify(integrationDraft(draft.winCondition, raw)) };
    const data = raw as {
      actionGroups: { purpose: number; actions: string[] }[];
    };
    return {
      response: JSON.stringify({
        ...(draft.gainingGoal ? { gainingGoal: draft.gainingGoal } : {}),
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

export function purposeDraft(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const { winCondition: _win, ...rest } = value as Record<string, unknown>;
  void _win;
  return rest;
}
export function integrationDraft(
  winCondition: unknown,
  data: { purposes: { purpose: number; text: string }[]; elements: Record<string, string[]> },
) {
  return {
    contributions: data.purposes.map((p) => ({ purpose: p.purpose, text: p.text.slice(0, 100) })),
    elementConsiderations: Object.fromEntries(
      elementKeys.map((key) => [
        key,
        {
          role: data.elements[key]?.length ? 'background' : 'unknown',
          sourceElements: data.elements[key]?.length ? [key] : [],
        },
      ]),
    ),
    winCondition,
  };
}
export function reviewDraft(data: { purposes: { purpose: number }[] }, issues: string[] = []) {
  return {
    meaningChecks: Object.fromEntries(
      [
        'decisionTarget',
        'completedOutcome',
        'claimStrength',
        'constraintCoverage',
        'readableSentence',
      ].map((key) => [
        key,
        {
          passed: true,
          reason: '原資料と検証対象の意味は一致する。',
          sourceQuote: '',
          candidateQuote: '',
        },
      ]),
    ),
    purposeChecks: data.purposes.map((p) => ({ purpose: p.purpose, integrated: !issues.length })),
    elementChecks: Object.fromEntries(elementKeys.map((key) => [key, true])),
    grounded: !issues.length,
    wholeSituation: !issues.length,
    issues,
  };
}
export function mockPufuStages(facts: unknown, plan: unknown) {
  return vi.fn<NonNullable<Env['AI']>['run']>().mockImplementation(async (_model, input) => {
    const data = JSON.parse(input.messages[1].content);
    const value =
      'sources' in data
        ? facts && typeof facts === 'object'
          ? { conditions: [], ...facts }
          : facts
        : 'actionGroups' in data
          ? purposeDraft(plan)
          : 'winCondition' in data
            ? reviewDraft(data)
            : integrationDraft((plan as { winCondition?: unknown })?.winCondition, data);
    return { response: JSON.stringify(value) };
  });
}
