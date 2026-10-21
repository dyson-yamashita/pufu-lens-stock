import { z } from 'zod';

export const pufuViewerUri = 'ui://pufu/viewer-v1.html';
const identifier = z.string().min(1).max(100);

export const pufuViewerSchema = z.object({
  status: z.enum(['ready', 'not_created']),
  question_id: identifier,
  project_id: identifier,
  pufu_id: identifier.nullable(),
  title: z.string(),
  phase: z.number().int().positive().nullable(),
  revision: z.number().int().positive().nullable(),
  updated_at: z.string().nullable(),
  image_url: z.url().nullable(),
  download_url: z.url().nullable(),
  expires_at: z.iso.datetime().nullable(),
  mime_type: z.literal('image/png'),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});

// get_pufu_imageの互換応答からも同じ完成画像を読み込める。
export const pufuViewerReadySchema = pufuViewerSchema.extend({
  status: z.literal('ready'),
  pufu_id: identifier,
  phase: z.number().int().positive(),
  revision: z.number().int().positive(),
  image_url: z.url(),
  download_url: z.url(),
  expires_at: z.iso.datetime(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type PufuViewerImage = z.infer<typeof pufuViewerReadySchema>;
