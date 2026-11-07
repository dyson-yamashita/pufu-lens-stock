import type { PufuContext, PufuScore } from '../shared/pufu';
import type { PufuFacts } from './pufu-source-facts';

// Narrow source-backed checks for recurring check→removal errors, not a general semantic proof.
export function unsupportedPufuStrength(context: PufuContext, candidate: string): string[] {
  const source = [
    context.task,
    context.details,
    context.project.description,
    context.question?.text,
    ...(context.questions ?? []).map((q) => q.text),
    ...(context.stocks ?? (context.stock ? [context.stock] : [])).flatMap((stock) => [
      stock.content,
      stock.note,
    ]),
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n');
  const clauses = (text: string) =>
    Array.from(
      new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text),
      (part) => part.segment,
    )
      .flatMap((sentence) => sentence.split(/[、,;；]|\b(?:but|however|whereas)\b/iu))
      .filter(
        (clause) =>
          !/(?:排除|削除|除去|解消).{0,8}(?:しない|せず|しません|未実施|未確認|未定|予定なし)|\b(?:not|never)\s+(?:\w+\s+){0,3}(?:remove|delete|deduplicate|eliminate)|\b(?:no|without)\s+(?:\w+\s+){0,2}(?:deduplication|removal|deletion|elimination)\b/iu.test(
            clause,
          ),
      );
  const rules = [
    {
      claim:
        /重複(?:データ|項目|記録|の|を|が|は|も|すべて|全て|全件|\s){0,8}(?:排除|除去|削除|解消)|重複(?:なし|のない)|\b(?:deduplicat\w*|de-duplicat\w*|(?:remove\w*|eliminat\w*|delet\w*)\s+(?:all\s+)?(?:the\s+)?duplicates?|duplicate[- ]free)\b/iu,
      issue:
        '重複の確認を、原資料にない重複排除の達成へ強めないでください。 / Do not turn checking duplicates into unstated deduplication.',
    },
    {
      claim:
        /(?:誤検出|誤消去|誤り|エラー)(?:の|を|が|は|も|すべて|全て|全件|\s){0,8}(?:排除|解消|修正|除去)|\b(?:error[- ]free|(?:eliminat\w*|remov\w*|correct\w*)\s+(?:all\s+)?(?:the\s+)?(?:errors?|false positives?))\b/iu,
      issue:
        '確認を、原資料にない誤検出や誤りの排除・修正の保証へ強めないでください。 / Checking does not establish unstated error elimination.',
    },
  ];
  return rules
    .filter(
      (rule) =>
        clauses(candidate).some((clause) => rule.claim.test(clause)) &&
        !clauses(source).some((clause) => rule.claim.test(clause)),
    )
    .map((rule) => rule.issue);
}

export function missingPufuConditions(score: PufuScore, facts: PufuFacts): boolean {
  const canonical = (text: string) => text.replace(/\s+/gu, '').replace(/[。.;；]+$/gu, '');
  const values = [
    score.gainingGoal.text,
    score.winCondition.text,
    ...score.purposes.flatMap((p) => [p.text, ...p.measures.map((m) => m.text)]),
    ...Object.values(score.elements).map((node) => node.text),
  ].map(canonical);
  return (facts.conditions ?? []).some(
    (condition) => !values.some((value) => value.includes(canonical(condition.text))),
  );
}
