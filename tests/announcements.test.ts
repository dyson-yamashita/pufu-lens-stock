import { afterEach, expect, it } from 'vitest';
import { testApp } from './helpers';
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
