import { z } from 'zod';

export const feedbackActions = ['save', 'import', 'download', 'phase', 'edit'] as const;
export type FeedbackAction = (typeof feedbackActions)[number];
export const feedbackReasons = ['rage_click', 'navigation_loop', 'validation_repeat'] as const;
export type FeedbackReason = (typeof feedbackReasons)[number];
export const feedbackQuestionSchema = z.enum(['operation', 'expected', 'actual', 'steps']);
export type FeedbackQuestion = z.infer<typeof feedbackQuestionSchema>;
export const feedbackQuestions = {
  operation: 'どの操作だった？',
  expected: 'どう動いてほしかった？',
  actual: 'そのとき、どうなった？',
  steps: 'その前は、何をしていた？',
} as const;
export const feedbackCategories = ['unresponsive', 'navigation', 'input', 'other'] as const;
export const feedbackSchema = z.strictObject({
  request_id: z.uuid(),
  owner_id: z.string().min(1).max(100),
  round: z.number().int().min(0).max(2).default(0),
  answer: z.string().trim().min(1).max(1000).optional(),
  finish: z.boolean().default(false),
  screen: z.literal('pufu-editor'),
  category: z.enum(feedbackCategories),
  detail: z.string().trim().max(1000),
  reasons: z
    .array(z.strictObject({ type: z.enum(feedbackReasons), action: z.enum(feedbackActions) }))
    .max(5),
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
