// Only use submitted user text: the current screen and Pufi's prompts may mention
// unrelated features. Prefer the first topic mentioned in the conversation.
const topics = [
  ['manual', /マニュアル|説明書|\bmanual\b|\bdocumentation\b/i],
  ['save', /保存|\bsav(?:e|es|ed|ing)\b/i],
  ['import', /インポート|取り込み|取込|\bimport(?:s|ed|ing)?\b/i],
  ['download', /ダウンロード|エクスポート|\b(?:download|export)(?:s|ed|ing)?\b/i],
  ['input', /入力|\binput\b|\btyping\b/i],
  ['display', /表示|画面|\bdisplay\b|\bscreen\b/i],
  ['login', /ログイン|サインイン|\blog[ -]?in\b|\bsign[ -]?in\b/i],
  ['search', /検索|\bsearch(?:es|ed|ing)?\b/i],
] as const;

export function feedbackClosingTopic(messages: readonly string[]): string | null {
  for (const message of messages) {
    let first: { topic: string; index: number } | undefined;
    for (const [topic, pattern] of topics) {
      const match = pattern.exec(message);
      if (match && (!first || match.index < first.index)) first = { topic, index: match.index };
    }
    if (first) return first.topic;
  }
  return null;
}
