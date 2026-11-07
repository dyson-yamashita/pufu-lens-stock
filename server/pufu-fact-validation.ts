const reasons = {
  condition_quote_not_in_evidence: '条件の引用が指定した根拠区間に存在しません',
  evidence_not_found: '指定した根拠IDが資料に存在しません',
  subject_not_in_evidence: '対象名が指定した根拠区間に存在しません',
  action_index_out_of_range: '配置先の工程番号が範囲外です',
};

type Diagnostic = {
  reason: keyof typeof reasons;
  path: string;
  evidence: string;
  actionIndex?: number;
  actionCount?: number;
};

// 本文・対象名・モデル応答は保持せず、失敗した条件と位置だけを記録する。
export class PufuFactValidationError extends Error {
  readonly diagnostic: Diagnostic;

  constructor(message: string, diagnostic: Diagnostic) {
    const safe = { ...diagnostic, evidence: diagnostic.evidence.slice(0, 32) };
    super(`${message} ${reasons[safe.reason]}。${JSON.stringify(safe)}`);
    this.name = 'PufuFactValidationError';
    this.diagnostic = safe;
  }
}
