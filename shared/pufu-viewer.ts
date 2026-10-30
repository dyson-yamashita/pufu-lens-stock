import { z } from 'zod';
import { languageSchema } from './locale';

export const pufuViewerUri = 'ui://pufu/viewer-v1.html';
const identifier = z.string().min(1).max(100);

export const pufuViewerSchema = z.object({
  language: languageSchema.optional(),
  status: z.enum(['ready', 'not_created']),
  question_id: identifier.nullable(),
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

// Explicit UI slots; never scan or translate user-provided content.
export const pufuViewerMessages = {
  TITLE: { id: 'title', message: 'プ譜' },
  STATUS: { id: 'status', message: '読み込み中です…' },
  UPDATED: { id: 'updated', message: 'プ譜が更新されたため最新の内容を表示しています' },
  FIT: { id: 'fit', message: '横幅に合わせる' },
  FULLSCREEN: { id: 'fullscreen', message: '全画面' },
  DOWNLOAD: { id: 'download', message: 'PNGを開く・保存' },
  RETRY: { id: 'retry', message: '再取得' },
  EXTERNAL: { id: 'external', message: 'PNGを開く' },
  SUMMARY: { id: 'summary', message: '対象のプ譜' },
  VIEWER: { id: 'viewer', message: 'プ譜ビューアー', attribute: 'aria-label' },
  TOOLBAR: { id: 'toolbar', message: '画像の操作', attribute: 'aria-label' },
  ZOOM_OUT: { id: 'zoom-out', message: '縮小', attribute: 'aria-label' },
  ZOOM_IN: { id: 'zoom-in', message: '拡大', attribute: 'aria-label' },
  VIEWPORT: {
    id: 'viewport',
    message: 'プ譜画像。拡大後はスクロールやドラッグで移動できます。',
    attribute: 'aria-label',
  },
} as const;
