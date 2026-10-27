import { z } from 'zod';
export const relationIdsSchema = z
  .array(z.string().trim().min(1).max(100))
  .max(100)
  .transform((ids) => [...new Set(ids)].sort());
export type RelatedStock = { id: string; title: string };
export type RelatedQuestion = { id: string; text: string; source: 'ai' | 'user' };
export type StockRelations = { stocks?: RelatedStock[]; stock_ids?: string[] };
export type PufuRelations = StockRelations & {
  questions?: RelatedQuestion[];
  question_ids?: string[];
};
