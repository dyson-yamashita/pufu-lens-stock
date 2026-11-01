import type { PufuRelations, StockRelations } from './relations';
import type { ArticleSummary } from './domain';
import type { PufuScore } from './pufu';

export type Publication = {
  is_public: boolean;
  search_indexable: boolean;
  public_id: string | null;
  public_description: string;
  published_at: string | null;
};
export type PublicProject = {
  public_id: string;
  name: string;
  public_description: string;
  published_at: string;
  stock_count: number;
  question_count: number;
};
export type PublicProjectDetail = PublicProject & { pufu_count: number; search_indexable: number };
export type PublicStock = {
  id: string;
  title: string;
  source_url: string | null;
  domain: string;
  created_at: string;
  summary: ArticleSummary | null;
};
export type PublicQuestion = StockRelations & {
  id: string;
  text: string;
  source: 'ai' | 'user';
  stock_id: string | null;
  article_title: string | null;
  created_at: string;
  pufu_count: number;
};
export type PublicPufuSummary = {
  title?: string | null;
  id: string;
  task: string;
  current_phase: number;
  updated_at: string;
};
export type PublicPufu = PufuRelations &
  PublicPufuSummary & {
    question_id: string;
    question_text: string;
    phase: number;
    score: PufuScore;
  };
export type PublicList<T> = { items: T[]; total: number; page: number; has_more: boolean };

export type PublicStockDetail = {
  stock: PublicStock;
  questions: PublicQuestion[];
  total: number;
  page: number;
  has_more: boolean;
};
