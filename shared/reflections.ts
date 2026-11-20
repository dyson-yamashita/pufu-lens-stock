import { z } from 'zod';

const dayMs = 86400000;
const jstOffset = 9 * 3600000;
// 隔週の締めもすべてのプロジェクトで同じ月曜に揃える。
const firstMonday = Date.UTC(1970, 0, 5) - jstOffset;

export const reflectionPeriods = ['weekly', 'biweekly', 'monthly'] as const;
export const reflectionPeriodSchema = z.enum(reflectionPeriods);
export type ReflectionPeriod = z.infer<typeof reflectionPeriodSchema>;

export const reflectionDay = (at: number) => new Date(at + jstOffset).toISOString().slice(0, 10);

export function reflectionPeriodEnd(at: number, period: ReflectionPeriod): number {
  if (period === 'monthly') return Date.parse(`${reflectionDay(at).slice(0, 7)}-01`) - jstOffset;
  const interval = (period === 'biweekly' ? 14 : 7) * dayMs;
  return firstMonday + Math.floor((at - firstMonday) / interval) * interval;
}

export const reflectionUpdateSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('answer'),
    generation: z.number().int().positive(),
    answer: z.string().trim().min(1).max(2000),
  }),
  z.strictObject({
    action: z.enum(['dismiss', 'alternative', 'retry']),
    generation: z.number().int().positive(),
  }),
]);

export type Reflection = {
  id: string;
  project_id: string;
  project_name: string;
  start_at: string;
  end_at: string;
  generation: number;
  status: 'queued' | 'ready' | 'empty' | 'failed';
  text: string;
  answer: string | null;
  stocks: { id: string; title: string; created_at: string }[];
  pufus: { id: string; title: string }[];
};

export type ReflectionList = { reflections: Reflection[]; has_more: boolean };
