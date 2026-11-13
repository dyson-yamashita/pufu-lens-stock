import { z } from 'zod';

const textSchema = z.object({
  title: z.string().trim().min(1).max(100),
  summary: z.string().trim().min(1).max(240),
  paragraphs: z.array(z.string().trim().min(1).max(2000)).min(1).max(10),
});
const timestamp = z.iso.datetime({ precision: 3 }).nullable();
/** 管理者CLIとDB読取の両方で使う。通知有無は明示指定を必須にする。 */
export const announcementSchema = z
  .strictObject({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    category: z.enum(['feature', 'maintenance', 'important']),
    publishedAt: timestamp,
    notify: z.boolean(),
    notifyAt: timestamp,
    ja: textSchema,
    en: textSchema,
  })
  .superRefine((item, ctx) => {
    if (
      item.notify
        ? !item.notifyAt || !item.publishedAt || item.notifyAt < item.publishedAt
        : item.notifyAt !== null
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          '通知ありは公開日時以降の通知日時が必要です。通知なしはnotifyAtをnullにしてください。',
      });
    }
  });
export type Announcement = z.infer<typeof announcementSchema>;
export function announcementHref(id: string) {
  return `/#announcements/${encodeURIComponent(id)}`;
}
