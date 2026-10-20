import { z } from 'zod';

export const summarySchema = z.object({
  overview: z.string().min(1).max(1600),
  keyPoints: z.array(z.string().min(1).max(500)).min(1).max(8),
  topics: z.array(z.string().min(1).max(40)).min(1).max(8),
});
export type ArticleSummary = z.infer<typeof summarySchema>;
export const stockListOptionsSchema = z.object({
  limit: z.number().int().min(1).max(24).default(24),
  sort_by: z.literal('created_at').default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
  detail: z.enum(['compact', 'full']).default('full'),
});
export const stockSearchOptionsSchema = z.object({
  mode: z.enum(['keyword', 'semantic', 'hybrid']).default('keyword'),
  min_score: z.number().min(0).max(1).default(0.35),
});
export const stockTextLimit = 20000;
const stockFields = {
  project_id: z.string().min(1).max(100).optional(),
  note: z.string().max(2000).default(''),
};
export const stockInputSchema = z.union([
  z
    .object({
      ...stockFields,
      type: z.literal('url').default('url'),
      supplemental_text: z.string().trim().min(1).max(stockTextLimit).optional(),
      url: z.string().trim().min(1, 'URLを入力してください。').max(4096),
    })
    .strict(),
  z
    .object({
      ...stockFields,
      type: z.literal('text'),
      title: z.string().trim().max(200).default(''),
      text: z
        .string()
        .trim()
        .min(1, '本文を入力してください。')
        .max(stockTextLimit, '本文は20,000文字以内で入力してください。'),
    })
    .strict(),
]);
export const questionSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, '問いを入力してください。')
    .max(500, '問いは500文字以内で入力してください。'),
});
export const userQuestionSchema = questionSchema
  .extend({
    project_id: z.string().trim().min(1, 'プロジェクトを選択してください。').max(100).optional(),
    stock_id: z.string().trim().min(1).max(100).nullable().optional(),
    request_id: z.uuid().optional(),
  })
  .strict()
  .refine((input) => input.project_id || input.stock_id, {
    message: 'プロジェクトを選択してください。',
    path: ['project_id'],
  });
export type Question = {
  id: string;
  stock_id: string | null;
  source: 'ai' | 'user';
  is_favorite: 0 | 1;
  has_pufu: 0 | 1;
  text: string | null;
  status: 'queued' | 'generating' | 'ready' | 'failed';
  error: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
  project_id: string;
  project_name: string;
  article_title: string | null;
  article_status: Stock['status'] | null;
  domain: string | null;
};
export const memorySchema = z.object({
  interests: z.array(z.string().min(1).max(300)).max(8),
  knowledge: z
    .array(
      z.object({
        text: z
          .string()
          .min(1)
          .max(500)
          .describe('1つの要点を1〜3文、全体で80〜120文字程度を目安に簡潔にまとめる。'),
        articleIds: z.array(z.string()).min(1).max(20),
      }),
    )
    .max(12),
  questions: z.array(z.string().min(1).max(300)).max(6),
});
export type MemoryData = z.infer<typeof memorySchema>;
export type MemoryUpdateMode = 'incremental' | 'full';
export type MemoryCoverage = {
  ready_count: number;
  reflected_count: number;
  pending_count: number;
  waiting_count: number;
  full_rebuild_reason: string | null;
};
export const profileSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, '名前を入力してください。')
    .max(80, '名前は80文字以内で入力してください。'),
  bio: z.string().trim().max(1000, '自己紹介は1,000文字以内で入力してください。'),
});
export type User = {
  id: string;
  name: string;
  bio: string;
  email: string;
  avatar_url: string | null;
};
export type Project = {
  id: string;
  name: string;
  description: string;
  show_in_all_lists: boolean;
  include_in_user_memory: boolean;
  count: number;
  ready_count: number;
  created_at: string;
  question_count: number;
};
export type Stock = {
  id: string;
  is_favorite: 0 | 1;
  article_id: string;
  project_id: string;
  project_name: string;
  title: string;
  source_type: 'url' | 'text';
  source_url: string;
  domain: string;
  note: string;
  status: 'queued' | 'extracting' | 'summarizing' | 'ready' | 'failed';
  summary: ArticleSummary | null;
  error: string | null;
  created_at: string;
  model: string | null;
};
export type Memory = {
  id: string;
  project_id: string | null;
  text: string;
  data: MemoryData;
  article_count: number;
  revision: number;
  current_revision: number;
  updated_at: string;
  model: string;
  pending: boolean;
  error: string | null;
};
export type TokenInfo = {
  id: string;
  name: string;
  prefix: string;
  project_id: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
};
export type Config = {
  demo: boolean;
  appUrl: string;
  googleConfigured: boolean;
  aiEnabled: boolean;
  aiModel: string | null;
};
