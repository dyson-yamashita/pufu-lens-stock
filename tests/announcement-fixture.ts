import type { Env } from '../server/env';
import type { Announcement } from '../shared/announcements';
export const testAnnouncement = (): Announcement => ({
  id: 'test-news',
  category: 'feature',
  publishedAt: new Date(Date.now() - 2000).toISOString(),
  notify: true,
  notifyAt: new Date(Date.now() - 2000).toISOString(),
  ja: {
    title: 'テストのお知らせ',
    summary: 'テスト用の案内です。',
    paragraphs: ['テスト本文です。'],
  },
  en: { title: 'Test announcement', summary: 'A test update.', paragraphs: ['Test content.'] },
});
export async function saveAnnouncement(env: Env, item: Announcement) {
  await env.DB.prepare(
    `INSERT INTO announcements(id,category,published_at,notify,notify_at,ja_json,en_json) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET category=excluded.category,published_at=excluded.published_at,notify=excluded.notify,notify_at=excluded.notify_at,ja_json=excluded.ja_json,en_json=excluded.en_json`,
  )
    .bind(
      item.id,
      item.category,
      item.publishedAt,
      Number(item.notify),
      item.notifyAt,
      JSON.stringify(item.ja),
      JSON.stringify(item.en),
    )
    .run();
}
