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
          !/(?:排除|削除|除去|解消|取り除).{0,8}(?:しない|せず|しません|行わない|行わず|実施しない|未実施|未確認|未定|予定なし)|\b(?:deduplication|removal|deletion|elimination)\s+(?:is|was|will be)\s+(?:not|never)\b|\b(?:not|never)\s+(?:\w+\s+){0,3}(?:remov\w*|delet\w*|deduplicat\w*|eliminat\w*)|\b(?:no|without)\s+(?:\w+\s+){0,2}(?:deduplicat\w*|remov\w*|delet\w*|eliminat\w*)\b/iu.test(
            clause,
          ),
      );
  // Only hard-reject in a checking context. Unknown wording remains the model review's job.
  if (!/確認|点検|照合|\b(?:check\w*|inspect\w*|verif\w*|compar\w*)\b/iu.test(source)) return [];
  const rules = [
    {
      claim:
        /重複(?:データ|項目|記録|の|を|が|は|も|すべて|全て|全件|\s){0,8}(?:排除|除去|削除|解消|取り除|取り去|取除|除く|除き|除いた|消去|なくす|無くす)|重複(?:なし|のない)|\b(?:deduplicat\w*|de-duplicat\w*|(?:remove\w*|eliminat\w*|delet\w*)\s+(?:all\s+)?(?:the\s+)?duplicates?|duplicate[- ]free)\b/iu,
      support:
        /重複.{0,30}(?:排除|除去|削除|解消|取り除|取り去|取除|除く|除き|除いた|消去|なくす|無くす)|重複(?:なし|のない)|\b(?:deduplicat\w*|de-duplicat\w*|duplicate[- ]free|(?:remov\w*|eliminat\w*|delet\w*).{0,40}duplicate)/iu,
      issue:
        '重複の確認を、原資料にない重複排除の達成へ強めないでください。 / Do not turn checking duplicates into unstated deduplication.',
    },
    {
      claim:
        /(?:誤検出|誤消去|誤り|エラー)(?:の|を|が|は|も|すべて|全て|全件|\s){0,8}(?:排除|解消|修正|除去)|\b(?:error[- ]free|(?:eliminat\w*|remov\w*|correct\w*)\s+(?:all\s+)?(?:the\s+)?(?:errors?|false positives?))\b/iu,
      support:
        /(?:誤検出|誤消去|誤り|エラー).{0,30}(?:排除|解消|修正|除去)|\b(?:error[- ]free|(?:eliminat\w*|remov\w*|correct\w*).{0,40}(?:error|false positive))/iu,
      issue:
        '確認を、原資料にない誤検出や誤りの排除・修正の保証へ強めないでください。 / Checking does not establish unstated error elimination.',
    },
  ];
  return rules
    .filter(
      (rule) =>
        clauses(candidate).some((clause) => rule.claim.test(clause)) &&
        !clauses(source).some((clause) => rule.support.test(clause)),
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
