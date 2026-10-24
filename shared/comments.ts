import { z } from 'zod';

const targetFields = {
  target_type: z.enum(['stock', 'question', 'pufu']),
  target_id: z.string().min(1).max(100),
  phase: z.number().int().positive().optional(),
};
export const commentTargetSchema = z
  .object(targetFields)
  .refine(
    (target) =>
      target.target_type === 'pufu' ? target.phase !== undefined : target.phase === undefined,
    {
      message: 'プ譜には局面番号を指定してください。ストック・問い・気づきには指定できません。',
      path: ['phase'],
    },
  );
export const addCommentSchema = commentTargetSchema
  .extend({
    body: z.string().trim().min(1).max(2000),
    request_id: z.uuid(),
  })
  .strict();
export const listCommentsSchema = commentTargetSchema
  .extend({
    page: z.number().int().min(1).max(5000).default(1),
  })
  .strict();
export type CommentTarget = z.infer<typeof commentTargetSchema>;
export type EntityComment = CommentTarget & {
  id: string;
  body: string;
  author_id: string;
  author_name: string;
  author_kind: 'user' | 'agent';
  created_at: string;
};
export type CommentList = { comments: EntityComment[]; has_more: boolean };
