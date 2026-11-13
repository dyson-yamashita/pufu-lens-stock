import { announcementSchema, type Announcement } from '../shared/announcements';
import type { Env } from './env';

export type AnnouncementRow = {
  id: string;
  category: string;
  published_at: string | null;
  notify: number;
  notify_at: string | null;
  ja_json: string;
  en_json: string;
};
export function readAnnouncement(row: AnnouncementRow): Announcement {
  return announcementSchema.parse({
    id: row.id,
    category: row.category,
    publishedAt: row.published_at,
    notify: row.notify === 1,
    notifyAt: row.notify_at,
    ja: JSON.parse(row.ja_json),
    en: JSON.parse(row.en_json),
  });
}
const columns = 'id,category,published_at,notify,notify_at,ja_json,en_json';
export async function listAnnouncements(env: Env, id?: string): Promise<Announcement[]> {
  const at = new Date().toISOString();
  const rows = await env.DB.prepare(
    `SELECT ${columns} FROM announcements WHERE published_at IS NOT NULL AND published_at<=?${id ? ' AND id=?' : ''} ORDER BY published_at DESC,id DESC LIMIT 100`,
  )
    .bind(...(id ? [at, id] : [at]))
    .all<AnnouncementRow>();
  return rows.results.map(readAnnouncement);
}
export async function notificationAnnouncements(env: Env): Promise<Announcement[]> {
  const at = new Date().toISOString();
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  const rows = await env.DB.prepare(
    `SELECT ${columns} FROM announcements a WHERE published_at IS NOT NULL AND published_at<=? AND notify=1 AND notify_at<=? AND notify_at>=? AND EXISTS(SELECT 1 FROM push_subscriptions p JOIN sessions s ON s.token_hash=p.session_hash WHERE p.created_at<=a.notify_at AND s.expires_at>? AND NOT EXISTS(SELECT 1 FROM push_deliveries d WHERE d.announcement_id=a.id AND d.subscription_id=p.id)) ORDER BY notify_at,id LIMIT 10`,
  )
    .bind(at, at, cutoff, at)
    .all<AnnouncementRow>();
  return rows.results.map(readAnnouncement);
}
