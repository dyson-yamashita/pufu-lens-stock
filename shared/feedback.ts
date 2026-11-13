import { z } from 'zod';

export const feedbackActions = [
  'save',
  'import',
  'download',
  'phase',
  'edit',
  'control',
  'input',
  'request',
] as const;
export type FeedbackAction = (typeof feedbackActions)[number];
export const feedbackReasons = [
  'rage_click',
  'navigation_loop',
  'validation_repeat',
  'operation_repeat',
  'network_repeat',
  'exploration_repeat',
] as const;
export type FeedbackReason = (typeof feedbackReasons)[number];
export const feedbackQuestionSchema = z.enum(['operation', 'expected', 'actual', 'steps']);
export type FeedbackQuestion = z.infer<typeof feedbackQuestionSchema>;
export const feedbackQuestions = {
  operation: 'どの操作でお困りでしたか？',
  expected: 'どのような動きを期待されていましたか？',
  actual: 'そのとき、どのような状態になりましたか？',
  steps: '直前に行っていた操作を教えていただけますか？',
} as const;
export const feedbackCategories = ['unresponsive', 'navigation', 'input', 'other'] as const;
export const feedbackScreens = [
  'pufu-editor',
  'manual',
  'stocks',
  'stock',
  'questions',
  'question',
  'pufus',
  'memory',
  'profile',
  'settings',
  'mcp',
  'shortcuts',
  'app',
] as const;
export type FeedbackScreen = (typeof feedbackScreens)[number];
export const feedbackSchema = z.strictObject({
  // Accept older clients, but store only a bounded path without query/hash.
  page_path: z
    .string()
    .max(4096)
    .transform((value) => value.split(/[?#]/, 1)[0])
    .pipe(
      z
        .string()
        .max(2048)
        .regex(/^\/(?![/\\])[^\\\s]*$/),
    )
    .nullable()
    .optional(),
  viewport: z
    .string()
    .regex(/^[1-9]\d{0,4}x[1-9]\d{0,4}$/)
    .nullable()
    .optional(),
  request_id: z.uuid(),
  owner_id: z.string().min(1).max(100),
  round: z.number().int().min(0).max(2).default(0),
  answer: z.string().trim().min(1).max(1000).optional(),
  finish: z.boolean().default(false),
  screen: z.enum(feedbackScreens),
  category: z.enum(feedbackCategories),
  detail: z.string().trim().max(1000),
  language: z.enum(['ja', 'en']).optional(),
  manual_context: z
    .strictObject({
      question: z.string().trim().min(1).max(1000),
      topic: z.string().max(160),
      section: z
        .string()
        .regex(/^manual-[a-z0-9-]+$/)
        .max(100),
    })
    .optional(),
  reasons: z
    .array(z.strictObject({ type: z.enum(feedbackReasons), action: z.enum(feedbackActions) }))
    .max(feedbackReasons.length),
  consent: z.literal(true),
});
export type FeedbackInput = z.infer<typeof feedbackSchema>;
export type FeedbackMessage = { role: 'pufi' | 'user'; text: string };
export type FeedbackReceipt = {
  received: true;
  round: number;
  follow_up: FeedbackQuestion | null;
  pending: boolean;
};
