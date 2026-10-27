import type { PufuContext } from '../shared/pufu';

type SourceStock = NonNullable<PufuContext['stock']>;
// 全関連を保持しつつ、永続ステップとAIへ渡す資料量をそれぞれ制限する。
function fit<T>(make: (limit: number) => T, budget: number): T {
  let low = 0;
  let high = 20000;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (JSON.stringify(make(middle)).length <= budget) low = middle;
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
export function promptStocks(stocks: SourceStock[]) {
  const budget = Math.floor((14000 - stocks.length - 1) / Math.max(1, stocks.length));
  return stocks.map((stock) =>
    fit(
      (limit) => ({
        title: stock.title.slice(0, Math.min(200, limit)),
        summary: stock.summary
          ? [stock.summary.overview, ...stock.summary.keyPoints].join('\n').slice(0, limit * 3)
          : '',
        note: stock.note.slice(0, limit),
      }),
      budget,
    ),
  );
}
