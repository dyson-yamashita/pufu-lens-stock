import { announcementSchema, type Announcement } from '../shared/announcements.ts';
export function announcementRegistrationSql(input: Announcement) {
  const item = announcementSchema.parse(input);
  const quote = (value: string | null) =>
    value === null ? 'NULL' : `'${value.replaceAll("'", "''")}'`;
  return `INSERT INTO announcements(id,category,published_at,notify,notify_at,ja_json,en_json)
VALUES (${[item.id, item.category, item.publishedAt].map(quote).join(',')},${Number(item.notify)},${[item.notifyAt, JSON.stringify(item.ja), JSON.stringify(item.en)].map(quote).join(',')})
ON CONFLICT(id) DO UPDATE SET category=excluded.category,published_at=excluded.published_at,notify=excluded.notify,notify_at=excluded.notify_at,ja_json=excluded.ja_json,en_json=excluded.en_json,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');`;
}
