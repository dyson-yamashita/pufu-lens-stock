import { afterEach, expect, it, vi } from 'vitest';
import { testApp } from './helpers';
import { deliverAnnouncements } from '../server/push-delivery';
import { announcementSchema, type Announcement } from '../shared/announcements';
import { testAnnouncement, saveAnnouncement } from './announcement-fixture';

let app: Awaited<ReturnType<typeof testApp>>;
afterEach(async () => {
  vi.unstubAllGlobals();
  await app?.dispose();
  app = undefined!;
});
async function setup() {
  app = await testApp();
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const jwk = await crypto.subtle.exportKey('jwk', keys.privateKey);
  Object.assign(app.env, {
    PUSH_ENABLED: 'true',
    VAPID_PUBLIC_KEY: Buffer.from(await crypto.subtle.exportKey('raw', keys.publicKey)).toString(
      'base64url',
    ),
    VAPID_PRIVATE_KEY: jwk.d,
    VAPID_SUBJECT: 'mailto:operator@example.com',
  });
  const receiver = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const body = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test',
    keys: {
      p256dh: Buffer.from(await crypto.subtle.exportKey('raw', receiver.publicKey)).toString(
        'base64url',
      ),
      auth: Buffer.alloc(16, 1).toString('base64url'),
    },
  };
  expect((await app.request('/api/v1/push/subscription', { method: 'PUT', body })).status).toBe(
    200,
  );
  const publishedAt = new Date(Date.now() - 2000).toISOString();
  await app.env.DB.prepare('UPDATE push_subscriptions SET created_at=?')
    .bind(new Date(Date.now() - 5000).toISOString())
    .run();
  const item = { ...testAnnouncement(), publishedAt, notifyAt: publishedAt };
  await saveAnnouncement(app.env, item);
  return [item] satisfies Announcement[];
}
it('暗号化したWeb Pushを送信し、Cron重複実行・本文訂正でも同じIDを再送しない', async () => {
  const catalog = await setup();
  const outgoing = vi.fn(async () => new Response(null, { status: 201 }));
  vi.stubGlobal('fetch', outgoing);
  await Promise.all([deliverAnnouncements(app.env), deliverAnnouncements(app.env)]);
  expect(outgoing).toHaveBeenCalledTimes(1);
  const options = outgoing.mock.calls[0] as unknown as [string, RequestInit];
  expect(options[1]).toMatchObject({
    redirect: 'error',
    headers: { 'content-encoding': 'aes128gcm' },
  });
  expect(options[1].body).toBeInstanceOf(Uint8Array);
  expect((options[1].body as Uint8Array).length).toBeGreaterThan(100);
  catalog[0].ja.title = '訂正後';
  await saveAnnouncement(app.env, catalog[0]);
  await deliverAnnouncements(app.env);
  expect(outgoing).toHaveBeenCalledTimes(1);
  expect(await app.env.DB.prepare('SELECT status FROM push_deliveries').first('status')).toBe(
    'sent',
  );
});
it('一時障害を再試行し、410は購読と台帳を削除する', async () => {
  await setup();
  const outgoing = vi.fn(async () => new Response(null, { status: 503 }));
  vi.stubGlobal('fetch', outgoing);
  await deliverAnnouncements(app.env);
  expect(await app.env.DB.prepare('SELECT status FROM push_deliveries').first('status')).toBe(
    'pending',
  );
  await deliverAnnouncements(app.env);
  expect(outgoing).toHaveBeenCalledTimes(1);
  await app.env.DB.prepare(
    "UPDATE push_deliveries SET next_attempt_at='2000-01-01T00:00:00.000Z'",
  ).run();
  outgoing.mockResolvedValue(new Response(null, { status: 410 }));
  await deliverAnnouncements(app.env);
  expect(await app.env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first('n')).toBe(
    0,
  );
  expect(await app.env.DB.prepare('SELECT COUNT(*) AS n FROM push_deliveries').first('n')).toBe(0);
});
it('無効時・下書き・未来・古い通知・購読前の通知・失効セッションには送信しない', async () => {
  const catalog = await setup();
  const outgoing = vi.fn();
  vi.stubGlobal('fetch', outgoing);
  app.env.PUSH_ENABLED = 'false';
  await deliverAnnouncements(app.env);
  app.env.PUSH_ENABLED = 'true';
  const future = new Date(Date.now() + 86400000).toISOString();
  const old = new Date(Date.now() - 10 * 86400000).toISOString();
  for (const item of [
    { ...catalog[0], publishedAt: null, notify: false, notifyAt: null },
    { ...catalog[0], publishedAt: future, notifyAt: future },
    { ...catalog[0], publishedAt: old, notifyAt: old },
    { ...catalog[0], notify: false, notifyAt: null },
  ]) {
    await saveAnnouncement(app.env, item);
    await deliverAnnouncements(app.env);
  }
  await saveAnnouncement(app.env, catalog[0]);
  await app.env.DB.prepare('UPDATE push_subscriptions SET created_at=?')
    .bind(new Date().toISOString())
    .run();
  await deliverAnnouncements(app.env);
  await app.env.DB.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z'").run();
  await deliverAnnouncements(app.env);
  expect(outgoing).not.toHaveBeenCalled();
});
it('登録データは通知有無を必須にし、下書きの通知・公開前の通知を拒否する', () => {
  const item = testAnnouncement();
  expect(announcementSchema.safeParse(item).success).toBe(true);
  for (const invalid of [
    { ...item, notify: undefined },
    { ...item, notify: false },
    { ...item, publishedAt: null },
    { ...item, notifyAt: '2000-01-01T00:00:00.000Z' },
    { ...item, id: 'invalid/id' },
  ])
    expect(announcementSchema.safeParse(invalid).success).toBe(false);
  expect(announcementSchema.safeParse({ ...item, notify: false, notifyAt: null }).success).toBe(
    true,
  );
});

it('10件を超える通知でも完了済みの記事が後続記事の配信を妨げない', async () => {
  const [item] = await setup();
  await app.env.DB.prepare('DELETE FROM announcements WHERE id=?').bind(item.id).run();
  for (let i = 0; i < 11; i++)
    await saveAnnouncement(app.env, { ...item, id: `news-${String(i).padStart(2, '0')}` });
  const outgoing = vi.fn(async () => new Response(null, { status: 201 }));
  vi.stubGlobal('fetch', outgoing);
  await deliverAnnouncements(app.env);
  expect(outgoing).toHaveBeenCalledTimes(10);
  await deliverAnnouncements(app.env);
  expect(outgoing).toHaveBeenCalledTimes(11);
});
