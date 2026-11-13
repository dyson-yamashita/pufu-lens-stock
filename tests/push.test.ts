import { afterEach, describe, expect, it } from 'vitest';
import { testApp } from './helpers';

let app: Awaited<ReturnType<typeof testApp>>;
afterEach(async () => {
  await app?.dispose();
});
const endpoint = 'https://fcm.googleapis.com/fcm/send/test-device';
async function subscription() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    endpoint,
    keys: {
      p256dh: Buffer.from(raw).toString('base64url'),
      auth: Buffer.alloc(16, 1).toString('base64url'),
    },
  };
}
async function setup() {
  app = await testApp();
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  Object.assign(app.env, {
    PUSH_ENABLED: 'true',
    VAPID_SUBJECT: 'mailto:operator@example.com',
    VAPID_PUBLIC_KEY: Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString(
      'base64url',
    ),
    VAPID_PRIVATE_KEY: jwk.d,
  });
}
describe('端末のPush購読', () => {
  it('初期は管理者未設定、設定後は本人だけが購読・解除でき、ログアウトで削除する', async () => {
    app = await testApp();
    expect(await (await app.request('/api/v1/push')).json()).toMatchObject({ available: false });
    await app.dispose();
    await setup();
    const body = await subscription();
    expect((await app.request('/api/v1/push/subscription', { method: 'PUT', body })).status).toBe(
      200,
    );
    expect(await (await app.request('/api/v1/push')).json()).toMatchObject({ available: true });
    expect(
      (await app.request('/api/v1/push/subscription', { method: 'PUT', body, user: 'bob' })).status,
    ).toBe(409);
    await app.request('/api/v1/push/subscription', {
      method: 'DELETE',
      body: { endpoint },
      user: 'bob',
    });
    expect(
      await app.env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first('n'),
    ).toBe(1);
    await app.request('/api/v1/logout', { method: 'POST', body: {} });
    expect(
      await app.env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first('n'),
    ).toBe(0);
  });
  it('同じブラウザーの再ログインで旧セッションの購読を削除する', async () => {
    await setup();
    await app.request('/api/v1/push/subscription', { method: 'PUT', body: await subscription() });
    expect(
      await app.env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first('n'),
    ).toBe(1);
    app.env.LOCAL_DEMO_ENABLED = 'true';
    const result = await app.request('/api/auth/demo', { method: 'POST', body: {} });
    expect(result.status).toBe(200);
    expect(
      await app.env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first('n'),
    ).toBe(0);
  });
  it('内部URL・リダイレクト先・無効な暗号鍵・クロスオリジン・匿名の登録を拒否する', async () => {
    await setup();
    const body = await subscription();
    for (const invalid of [
      'https://localhost/push',
      'https://example.com/push',
      'http://fcm.googleapis.com/push',
      'https://fcm.googleapis.com.evil.test/push',
    ]) {
      expect(
        (
          await app.request('/api/v1/push/subscription', {
            method: 'PUT',
            body: { ...body, endpoint: invalid },
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await app.request('/api/v1/push/subscription', {
          method: 'PUT',
          body: { ...body, keys: { p256dh: 'x', auth: 'x' } },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request('/api/v1/push/subscription', {
          method: 'PUT',
          body,
          headers: { Origin: 'https://evil.test' },
        })
      ).status,
    ).toBe(403);
    expect((await app.request('/api/v1/push', { headers: { Cookie: '' } })).status).toBe(401);
  });
});
