import { z } from 'zod';
import { relationIdsSchema, type PufuRelations } from './relations';
import type { ArticleSummary, MemoryData } from './domain';

export const pufuEditorVersion = '0.9.19';
export { elementKeys, pufuScoreSchema } from '@pufu-lens/pufu-image/model';
import { pufuScoreSchema } from '@pufu-lens/pufu-image/model';
export type PufuScore = z.infer<typeof pufuScoreSchema>;
export const createPufuSchema = z.strictObject({
  task: z
    .string()
    .trim()
    .min(1, '課題を入力してください。')
    .max(1000, '課題は1,000文字以内で入力してください。'),
  request_id: z.uuid(),
});
const pufuRelationFields = {
  question_id: z.string().min(1).max(100).nullable().optional(),
  question_ids: relationIdsSchema.optional(),
  stock_ids: relationIdsSchema.optional(),
};
export const pufuRelationsSchema = z.strictObject({
  revision: z.number().int().positive(),
  question_ids: relationIdsSchema,
  stock_ids: relationIdsSchema,
});
export const savePufuSchema = z.strictObject({
  revision: z.number().int().positive(),
  phase: z.number().int().positive().optional(),
  score: pufuScoreSchema,
  ...pufuRelationFields,
});
export const createSavedPufuSchema = z.strictObject({
  project_id: z.string().min(1).max(100),
  ...pufuRelationFields,
  score: pufuScoreSchema,
  request_id: z.uuid(),
});
export const addPufuPhaseSchema = savePufuSchema.extend({ phase: z.number().int().positive() });
export type PufuPhase = {
  number: number;
  score: PufuScore;
  created_at: string;
  updated_at: string;
};
export type MemorySnapshot = {
  id: string;
  revision: number;
  text: string;
  data: MemoryData;
  updated_at: string;
};
export type PufuContext = {
  question: { id: string; text: string; source: 'ai' | 'user' } | null;
  task: string;
  project: { id: string; name: string; description: string };
  stock: { id: string; title: string; summary: ArticleSummary | null; note: string } | null;
  stocks?: NonNullable<PufuContext['stock']>[];
  userMemory: MemorySnapshot | null;
  projectMemory: MemorySnapshot | null;
};
export type PufuSummary = PufuRelations & {
  id: string;
  question_id: string | null;
  project_id: string;
  task: string;
  status: 'queued' | 'generating' | 'ready' | 'failed';
  error: string | null;
  model: string | null;
  editor_version: string;
  revision: number;
  current_phase: number;
  generation: number;
  created_at: string;
  updated_at: string;
};
export type Pufu = PufuSummary & {
  score: PufuScore | null;
  phases: PufuPhase[];
  context: PufuContext;
};
export type PufuListItem = PufuSummary & {
  project_id: string;
  project_name: string;
  question_text: string | null;
};
