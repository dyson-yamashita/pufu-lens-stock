import { z } from 'zod';

export const feedbackActions = ['save', 'import', 'download', 'phase', 'edit'] as const;
export type FeedbackAction = (typeof feedbackActions)[number];
export const feedbackReasons = ['rage_click', 'navigation_loop', 'validation_repeat'] as const;
export type FeedbackReason = (typeof feedbackReasons)[number];
export const feedbackQuestions = {
  operation: 'どのボタンや操作で困りましたか？',
  expected: 'その操作で、どのようになることを期待していましたか？',
  actual: '実際にはどのような動きや表示になりましたか？',
  steps: '問題が起きるまでの操作を教えてもらえますか？',
} as const;
export const feedbackCategories = ['unresponsive', 'navigation', 'input', 'other'] as const;
export const feedbackSchema = z.strictObject({
  request_id: z.uuid(),
  round: z.number().int().min(0).max(2).default(0),
  answer: z.string().trim().min(1).max(1000).optional(),
  screen: z.literal('pufu-editor'),
  category: z.enum(feedbackCategories),
  detail: z.string().trim().max(1000),
  reasons: z
    .array(
      z.strictObject({
        type: z.enum(feedbackReasons),
        action: z.enum(feedbackActions),
      }),
    )
    .max(5),
  consent: z.literal(true),
});
export type FeedbackInput = z.infer<typeof feedbackSchema>;
