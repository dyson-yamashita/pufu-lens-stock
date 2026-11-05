import { pufuScoreSchema, type PufuContext, type PufuScore } from '../shared/pufu';
import { defaultLanguage, type Language } from '../shared/locale';

export const cleanGeneratedText = (text: string) =>
  text
    .replace(
      /^(?:(?:仮説|参考事例|参考|出典|hypothesis|reference example|source)\s*[:：]\s*)+/i,
      '',
    )
    .trim();
function cleanElementText(text: string): string {
  const value = cleanGeneratedText(text);
  return /^(?:未定|未確認|未設定|不明|情報なし|記載なし|unknown|unconfirmed|undecided|not specified)[。.]?$/i.test(
    value,
  )
    ? ''
    : value;
}
function sentences(text: string): string[] {
  return Array.from(
    new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text),
    (part) => part.segment.trim(),
  ).filter(Boolean);
}
const unknownStatement = (text: string) =>
  /^(?:(?:[\p{Script=Han}\p{Script=Katakana}ー・\s]|の){1,60}(?:は|が|も))?(?:未定|未設定|不明|未確認|決まっていない)[。.!?]?$/u.test(
    text,
  ) ||
  /^(?:(?:budget|staffing|deadline|schedule|policy)(?: and (?:budget|staffing|deadline|schedule|policy))* (?:is|are) )?(?:undecided|unknown|not specified)[.!?]?$/i.test(
    text,
  );
// 主語と不採用の述語だけの文に限定する。複文を否定だけと判定しない。
const prohibitedActivity = (text: string) =>
  /^(?:[\p{Script=Han}\p{Script=Katakana}ー・\s]|の){1,60}(?:は|を|も)(?:(?:開催|実施|導入)(?:しない|していない)|行わない|禁止|対象外|範囲外)[。.!?]?$/u.test(
    text,
  ) ||
  /^(?:training|events|workshops|offsite inspections)(?: (?:and )?(?:training|events|workshops|offsite inspections))* (?:is|are) (?:out of scope|not (?:planned|permitted|allowed))[.!?]?$/i.test(
    text,
  );

const explicitMoneyCondition = (text: string) =>
  /[0-9０-９]+(?:万|千)?円|[$€£]\s*\d|\b\d+(?:[.,]\d+)?\s*(?:USD|JPY|EUR|GBP)\b|予算.{0,40}(?:以内|上限|下限|制約|限ら|不足)|購入(?:は|を)?(?:しない|行わない|禁止)|(?:追加|新規)(?:の)?購入(?:は|を|が)?(?:ない|なし|禁止)|\b(?:no|without)(?: (?:new|additional))? purchas(?:es?|ing)\b|\b(?:budget|spending|funding)\b.{0,40}\b(?:limit(?:ed)?|cap(?:ped)?|insufficient)\b/i.test(
    text,
  );

const sameLanguage = (text: string, language: Language) => {
  const japanese = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
  return language === 'en' ? !japanese : japanese || !/[a-z]/i.test(text);
};

// 未保存の自動生成結果だけを整形。ユーザーの編集・保存経路には適用しない。
export function normalizeGeneratedScore(
  input: PufuScore,
  context: PufuContext,
  language: Language = defaultLanguage,
): PufuScore {
  const score = structuredClone(pufuScoreSchema.parse(input));
  score.gainingGoal.text = context.task || cleanGeneratedText(score.gainingGoal.text);
  const generatedNodes = [
    score.winCondition,
    ...score.purposes.flatMap((p) => [p, ...p.measures]),
    ...Object.values(score.elements),
  ];
  for (const node of generatedNodes) node.text = cleanGeneratedText(node.text);
  for (const node of Object.values(score.elements)) node.text = cleanElementText(node.text);

  // 金額や購入方針は、ユーザーが明示した短い条件を優先して保持する。
  const money = sentences(context.details ?? '')
    .flatMap((text) =>
      text
        .split(/[;；]/)
        .map((part) => part.trim())
        .filter(Boolean),
    )
    .filter(
      (text) =>
        text.length <= 240 &&
        explicitMoneyCondition(text) &&
        sameLanguage(text, language) &&
        !unknownStatement(text),
    );
  if (money.length && money.join(' ').length <= 240) score.elements.money.text = money.join(' ');

  const stocks = (context.stocks ?? (context.stock ? [context.stock] : [])).slice(0, 1);
  const evidence = sentences(
    [
      context.details,
      context.project.description,
      context.questions?.[0]?.text ?? context.question?.text,
      ...stocks.flatMap((s) => [s.note, s.content]),
    ]
      .filter(Boolean)
      .join('\n'),
  );
  if (!evidence.length) for (const purpose of score.purposes) purpose.measures = [];
  // 未定情報と活動の不採用だけでは、実施する施策や担当体制の根拠にならない。
  if (
    evidence.length &&
    evidence.every((text) => unknownStatement(text) || prohibitedActivity(text))
  ) {
    score.purposes = [];
    score.winCondition.text = '';
    const translatedPolicy = score.elements.environment.text;
    for (const node of Object.values(score.elements)) node.text = '';
    let policy = '';
    const policies = evidence.filter(prohibitedActivity);
    for (const text of policies) {
      if ((policy + text).length > 240) break;
      policy += text;
    }
    score.elements.environment.text = policies.every((text) => sameLanguage(text, language))
      ? policy
      : translatedPolicy;
  }
  if (
    (!context.task && (!score.gainingGoal.text || score.gainingGoal.text.length > 200)) ||
    generatedNodes.some((node) => node.text.length > 240)
  )
    throw new Error('AIの出力形式が正しくありません。再試行してください。');
  for (const node of [score.gainingGoal, ...generatedNodes])
    node.comment = { color: 'blue', text: '' };
  return score;
}
