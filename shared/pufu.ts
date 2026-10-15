import { z } from 'zod';
import type { ArticleSummary, MemoryData } from './domain';

export const pufuEditorVersion = '0.9.14';
const nodeId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const comment = z.strictObject({
  color: z.enum(['blue', 'green', 'red']),
  text: z.string().max(600),
});
const node = z.strictObject({ uuid: nodeId, text: z.string().max(1200), comment });
const measure = node.extend({
  id: nodeId.optional(),
  color: z.enum(['white', 'blue', 'green', 'red', 'yellow']),
  progress: z.number().min(0).max(100).optional(),
});
export const elementKeys = [
  'people',
  'money',
  'time',
  'quality',
  'businessScheme',
  'environment',
  'rival',
  'foreignEnemy',
] as const;
export const pufuScoreSchema = z
  .strictObject({
    gainingGoal: node,
    winCondition: node,
    purposes: z.array(node.extend({ measures: z.array(measure).max(12) })).max(12),
    elements: z.strictObject({
      people: node,
      money: node,
      time: node,
      quality: node,
      businessScheme: node,
      environment: node,
      rival: node,
      foreignEnemy: node,
    }),
  })
  .superRefine((score, ctx) => {
    const nodes = [
      score.gainingGoal,
      score.winCondition,
      ...Object.values(score.elements),
      ...score.purposes.flatMap((p) => [p, ...p.measures]),
    ];
    if (new Set(nodes.map((item) => item.uuid)).size !== nodes.length)
      ctx.addIssue({ code: 'custom', message: '要素のIDが重複しています。' });
  });
export type PufuScore = z.infer<typeof pufuScoreSchema>;
export const createPufuSchema = z.strictObject({
  task: z
    .string()
    .trim()
    .min(1, '課題を入力してください。')
    .max(1000, '課題は1,000文字以内で入力してください。'),
  request_id: z.uuid(),
});
export const savePufuSchema = z.strictObject({
  revision: z.number().int().positive(),
  phase: z.number().int().positive().optional(),
  score: pufuScoreSchema,
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
  question: { id: string; text: string; source: 'ai' | 'user' };
  task: string;
  project: { id: string; name: string; description: string };
  stock: { id: string; title: string; summary: ArticleSummary | null; note: string } | null;
  userMemory: MemorySnapshot | null;
  projectMemory: MemorySnapshot | null;
};
export type PufuSummary = {
  id: string;
  question_id: string;
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
