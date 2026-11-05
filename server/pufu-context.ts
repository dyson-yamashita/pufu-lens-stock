import type { PufuContext } from '../shared/pufu';

type SourceStock = NonNullable<PufuContext['stock']>;
// 全関連を保持しつつ、永続ステップとAIへ渡す資料量をそれぞれ制限する。
function fit<T>(
  make: (limit: number) => T,
  budget: number,
  size = (value: T) => JSON.stringify(value).length,
): T {
  if (size(make(0)) > budget) throw new Error('プ譜の参照資料が入力上限を超えています。');
  let low = 0;
  let high = 20000;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (size(make(middle)) <= budget) low = middle;
    else high = middle - 1;
  }
  return make(low);
}
export function snapshotStocks(stocks: SourceStock[]): SourceStock[] {
  const budget = Math.floor((128000 - stocks.length - 1) / Math.max(1, stocks.length));
  return stocks.map((stock) =>
    fit(
      (limit) => ({
        id: stock.id,
        title: stock.title.slice(0, limit),
        note: stock.note.slice(0, limit),
        content: stock.content
          ? excerptParts(stock.content, limit * 4).join(excerptSeparator)
          : null,
        contentIncomplete: stock.contentIncomplete,
        contentExcerpted: stock.contentExcerpted || (stock.content?.length ?? 0) > limit * 4,
        summary: stock.summary && {
          ...stock.summary,
          overview: stock.summary.overview.slice(0, limit),
          keyPoints: stock.summary.keyPoints.map((text) => text.slice(0, limit)),
          topics: stock.summary.topics.map((text) => text.slice(0, limit)),
        },
      }),
      budget,
    ),
  );
}
export const excerptSeparator = '\n\n[…中略…]\n\n';
// 各抜粋は原文中で連続する。先頭・中央・末尾を保持し、未取得部分を接着しない。
export function excerptParts(text: string, maxChars: number): string[] {
  if (maxChars <= 0 || !text) return [];
  const parts = text.split(excerptSeparator).filter(Boolean);
  const total = parts.reduce((size, part) => size + part.length, 0);
  if (total <= maxChars) return parts;
  if (parts.length > 1) {
    // 再抜粋で3→9→27資料と増やさず、もとの各区間の代表箇所を保持する。
    const selected =
      parts.length <= 3
        ? parts
        : [parts[0], parts[Math.floor(parts.length / 2)], parts[parts.length - 1]];
    const selectedTotal = selected.reduce((n, part) => n + part.length, 0);
    return selected
      .map((part, index) => {
        const width = Math.floor((maxChars * part.length) / selectedTotal);
        const start =
          index === 0
            ? 0
            : index === selected.length - 1
              ? part.length - width
              : Math.floor((part.length - width) / 2);
        return part.slice(start, start + width).replace(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/g, '');
      })
      .filter(Boolean);
  }
  const count = 3;
  const width = Math.floor(maxChars / count);
  if (width < 1) return [];
  return Array.from({ length: count }, (_, i) => {
    const start = Math.floor(((text.length - width) * i) / (count - 1));
    return text.slice(start, start + width).replace(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/g, '');
  }).filter(Boolean);
}
