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

const permission =
  /許可|承認|認可|\b(?:approv(?:e|es|ed|al|ing)|authori[sz](?:e|es|ed|ation|ing)|permit(?:s|ted|ting)?|permission|clearance|cleared for (?:shift use|use|operation))\b/iu;
const defectFree =
  /(?:欠け|欠落|誤り|不具合|破損|傷)(?:の|が)な(?:い|く)|\b(?:(?:defect|damage|error)[ -]free|no (?:defects|damage|errors|missing (?:parts|pages))|without (?:any )?(?:defects|damage|errors|missing (?:parts|pages)))\b/iu;
const usability = /(?:利用|使用)できる|使える状態|\b(?:usable|ready for use|available for use)\b/iu;
const uncertainSupport =
  /未確認|未検証|保証(?:しない|できない)|とは限らない|わけではない|確認できない|\b(?:not guaranteed|not verified|not established|cannot guarantee|does not guarantee|not (?:yet )?(?:usable|ready for use|available for use)|not (?:be )?(?:approv(?:e|es|ed|ing)|clear(?:s|ed)?|authori[sz](?:e|es|ed|ing)|permit(?:s|ted|ting)?)|no (?:formal |mandatory )?(?:approval|permission)|(?:approval|permission) is not required)\b/iu;

function assertionClauses(text: string) {
  const separated = text.replace(
    /(する|ある|いる|なる|できる|れる|です|ます|した|ない|だ)が、/gu,
    '$1。',
  );
  return sentences(separated)
    .flatMap((sentence) =>
      /\bnot only\b/iu.test(sentence)
        ? [sentence]
        : sentence.split(/[;；]|\b(?:but|however|whereas)\b|しかし|ただし|けれども/iu),
    )
    .map((part) => part.trim())
    .filter(Boolean);
}

// 検査・判断という行動だけを、合格・利用可・許可・無欠の保証へ変えない。
function limitUnsupportedOutcomes(
  score: PufuScore,
  supportEvidence: string[],
  context: PufuContext,
  language: Language,
) {
  const support = [context.task, ...supportEvidence]
    .flatMap(assertionClauses)
    .filter((text) => !uncertainSupport.test(text))
    .join('\n');
  const check = (text: string) =>
    /確認|点検|検査|試験|目視|リハーサル|\b(?:check(?:s|ed|ing)?|inspect(?:ion|s|ed|ing)?|test(?:s|ed|ing)?|rehearsal)\b/iu.test(
      text,
    );
  const hasDecision =
    /判断|決定|可否|\b(?:decid(?:e|es|ed)|decision|judg(?:e|es|ment|ement)|go\/no-go)\b/iu.test(
      [
        score.elements.businessScheme.text,
        ...score.purposes.flatMap((p) => p.measures.map((m) => m.text)),
      ].join('\n'),
    );
  const fallback = (actions: string) =>
    language === 'ja'
      ? check(actions)
        ? hasDecision
          ? '確認結果を判断に利用できる状態になっている。'
          : '確認結果が得られている。'
        : '作業結果が得られている。'
      : check(actions)
        ? hasDecision
          ? 'Check results are available for the decision.'
          : 'Check results are available.'
        : 'The work results are available.';
  const unsupported = (text: string) =>
    assertionClauses(text).some(
      (part) =>
        !uncertainSupport.test(part) &&
        ((permission.test(part) && !permission.test(support)) ||
          (defectFree.test(part) && !defectFree.test(support)) ||
          (usability.test(part) && !usability.test(support))),
    );
  if (unsupported(score.winCondition.text))
    score.winCondition.text = fallback(
      score.purposes.flatMap((p) => p.measures.map((m) => m.text)).join('\n'),
    );
  for (const purpose of score.purposes)
    if (unsupported(purpose.text))
      purpose.text = fallback(purpose.measures.map((m) => m.text).join('\n'));
  if (unsupported(score.elements.quality.text)) score.elements.quality.text = '';
}

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
  if (money.length && money.join(' ').length <= 240) {
    // 金銭の文だけを置換し、同じ要素に併記された設備などの条件は保持する。
    const otherConditions = sentences(score.elements.money.text)
      .flatMap((text) =>
        text
          .split(/[;；]/)
          .map((part) => part.trim())
          .filter(Boolean),
      )
      .filter((text) => !explicitMoneyCondition(text));
    // 再適用時も句の境界を残す。小文字で続く英文はSegmenterが1文とみなすため。
    const combined = otherConditions.length
      ? [...money.map((text) => text.replace(/[。.]+$/, '')), ...otherConditions].join('; ')
      : money.join(' ');
    score.elements.money.text = combined.length <= 240 ? combined : money.join(' ');
  }

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
  const completeEvidence = sentences(
    [
      context.details,
      context.project.description,
      context.questions?.[0]?.text ?? context.question?.text,
      ...stocks.flatMap((s) => [
        s.note,
        !s.contentIncomplete && !s.contentExcerpted ? s.content : null,
      ]),
    ]
      .filter(Boolean)
      .join('\n'),
  );
  limitUnsupportedOutcomes(score, completeEvidence, context, language);
  if (
    (!context.task && (!score.gainingGoal.text || score.gainingGoal.text.length > 200)) ||
    generatedNodes.some((node) => node.text.length > 240)
  )
    throw new Error('AIの出力形式が正しくありません。再試行してください。');
  for (const node of [score.gainingGoal, ...generatedNodes])
    node.comment = { color: 'blue', text: '' };
  return score;
}
