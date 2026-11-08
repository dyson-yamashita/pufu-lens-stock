export const stockImageMaxBytes = 5 * 1024 * 1024;
export const stockImageMaxBase64Length = Math.ceil(stockImageMaxBytes / 3) * 4;
export const stockImageMcpMaxBytes = stockImageMaxBase64Length + 16384;
export const stockImageLimit = 10;
export const stockImageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type StockImage = {
  id: string;
  filename: string;
  content_type: (typeof stockImageTypes)[number];
  size: number;
  created_at: string;
};
