import { afterEach, expect, it } from 'vitest';
import { testApp, applyMigration } from './helpers';
import { testAnnouncement, saveAnnouncement } from './announcement-fixture';
let app: Awaited<ReturnType<typeof testApp>>;
afterEach(async () => {
  await app?.dispose();
});
it('DBの公開分だけを返し、下書きと未来のお知らせは一覧・直接取得から隠す', async () => {
  app = await testApp();
  const item = testAnnouncement();
  await saveAnnouncement(app.env, item);
  await saveAnnouncement(app.env, {
    ...item,
    id: 'draft',
    publishedAt: null,
    notify: false,
    notifyAt: null,
  });
  await saveAnnouncement(app.env, {
    ...item,
    id: 'future',
    publishedAt: new Date(Date.now() + 86400000).toISOString(),
    notify: false,
    notifyAt: null,
  });
  const list = (await (await app.request('/api/v1/announcements')).json()) as {
    announcements: { id: string }[];
  };
  expect(list.announcements.map((item) => item.id)).toContain('test-news');
  expect(list.announcements.map((item) => item.id)).not.toContain('draft');
  expect(list.announcements.map((item) => item.id)).not.toContain('future');
  for (const id of ['draft', 'future'])
    expect((await app.request(`/api/v1/announcements/${id}`)).status).toBe(404);
  await saveAnnouncement(app.env, { ...item, ja: { ...item.ja, title: '訂正後の本文' } });
  expect(await (await app.request('/api/v1/announcements/test-news')).json()).toMatchObject({
    announcements: [{ ja: { title: '訂正後の本文' } }],
  });
  expect((await app.request('/api/v1/announcements', { headers: { Cookie: '' } })).status).toBe(
    401,
  );
  expect((await app.request('/api/v1/announcements', { method: 'POST', body: item })).status).toBe(
    404,
  );
});

it('管理者の登録SQLは引用符を含む本文をそのまま保存し、同じIDを訂正できる', async () => {
  app = await testApp();
  const { announcementRegistrationSql } = await import('../scripts/announcement-input');
  const item = testAnnouncement();
  item.ja.paragraphs = ["'); DROP TABLE users; --\nお知らせ本文"];
  await app.env.DB.prepare(announcementRegistrationSql(item)).run();
  expect(await app.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBeGreaterThan(0);
  expect(await (await app.request('/api/v1/announcements/test-news')).json()).toMatchObject({
    announcements: [{ ja: { paragraphs: item.ja.paragraphs } }],
  });
  await app.env.DB.prepare(
    announcementRegistrationSql({ ...item, notify: false, notifyAt: null }),
  ).run();
  expect(
    await app.env.DB.prepare("SELECT notify FROM announcements WHERE id='test-news'").first(
      'notify',
    ),
  ).toBe(0);
});

it('初回記事の入口訂正を再適用しても運営の編集と通知指定を維持する', async () => {
  app = await testApp();
  await app.env.DB.prepare(
    "UPDATE announcements SET ja_json=json_set(ja_json,'$.paragraphs[1]','運営が編集した案内'),notify=1,notify_at=published_at WHERE id='2026-11-announcements'",
  ).run();
  await applyMigration(app.env.DB, '0052_notification_profile_entry.sql');
  const row = await app.env.DB.prepare(
    "SELECT json_extract(ja_json,'$.paragraphs[1]') AS paragraph,notify,notify_at,published_at FROM announcements WHERE id='2026-11-announcements'",
  ).first<{ paragraph: string; notify: number; notify_at: string; published_at: string }>();
  expect(row?.paragraph).toBe('運営が編集した案内');
  expect(row?.notify).toBe(1);
  expect(row?.notify_at).toBe(row?.published_at);
});
