import { z } from 'zod';

const dayMs = 86400000;
const jstOffset = 9 * 3600000;

export const reflectionDay = (at: number) => new Date(at + jstOffset).toISOString().slice(0, 10);
export const reflectionDayStart = (day: string) => Date.parse(day) - jstOffset;
export const reflectionDayEnd = (day: string) => reflectionDayStart(day) + dayMs;
export const reflectionWeekStart = (at: number) => {
  const weekday = new Date(at + jstOffset).getUTCDay();
  return reflectionDayStart(reflectionDay(at)) - ((weekday + 6) % 7) * dayMs;
};
export const recentReflectionDays = (days: number, at: number) => ({
  from: reflectionDay(at - (days - 1) * dayMs),
  to: reflectionDay(at),
});

export const reflectionRequestSchema = z
  .strictObject({
    project_id: z.string().min(1).max(100),
    from: z.iso.date(),
    to: z.iso.date(),
    request_id: z.uuid(),
  })
  .refine(({ from, to }) => from <= to);

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
  is_weekly: 0 | 1;
  start_at: string;
  end_at: string;
  generation: number;
  status: 'queued' | 'ready' | 'empty' | 'failed';
  text: string | null;
  answer: string | null;
  stocks: { id: string; title: string; created_at: string }[];
  pufus: { id: string; title: string }[];
};

export type ReflectionList = { reflections: Reflection[]; has_more: boolean };
