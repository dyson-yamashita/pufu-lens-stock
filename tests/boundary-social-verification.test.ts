import * as webPush from '@block65/webcrypto-web-push';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchXPost } from '../server/features/integrations/x';
import { deliverAnnouncements } from '../server/features/announcements/push-delivery';
import { saveAnnouncement, testAnnouncement } from './announcement-fixture';
import { testApp } from './helpers';

vi.mock('@block65/webcrypto-web-push', { spy: true });

let app: Awaited<ReturnType<typeof testApp>>;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await app?.dispose();
  app = undefined!;
});

const endpoint = 'https://fcm.googleapis.com/fcm/send/boundary-device';
async function pushSetup() {
  app = await testApp();
  const sender = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const senderJwk = await crypto.subtle.exportKey('jwk', sender.privateKey);
  Object.assign(app.env, {
    PUSH_ENABLED: 'true',
    VAPID_PUBLIC_KEY: Buffer.from(await crypto.subtle.exportKey('raw', sender.publicKey)).toString(
      'base64url',
    ),
    VAPID_PRIVATE_KEY: senderJwk.d,
    VAPID_SUBJECT: 'mailto:boundary-test@example.com',
  });
  const receiver = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const body = {
    endpoint,
    keys: {
      p256dh: Buffer.from(await crypto.subtle.exportKey('raw', receiver.publicKey)).toString(
        'base64url',
      ),
      auth: Buffer.alloc(16, 3).toString('base64url'),
    },
  };
  expect((await app.request('/api/v1/push/subscription', { method: 'PUT', body })).status).toBe(
    200,
  );
  await app.env.DB.prepare('UPDATE push_subscriptions SET created_at=?')
    .bind(new Date(Date.now() - 5000).toISOString())
    .run();
  const item = testAnnouncement();
  await saveAnnouncement(app.env, item);
  return { body, item };
}

describe('B12 SNS資格情報の照合', () => {
  it('configuredはXの有効性を主張せず、削除後の新たな取得は資格情報を送信しない', async () => {
    app = await testApp();
    app.env.INTEGRATION_ENCRYPTION_KEY = 'cd'.repeat(32);
    const secret = 'boundary-x-secret-never-return';
    const registration = await app.request('/api/v1/integrations/x', {
      method: 'PUT',
      body: { token: secret },
    });
    expect(registration.status).toBe(200);
    expect(await registration.json()).toEqual({ ok: true });
    const outgoing = vi.fn(async () => new Response(`provider-secret:${secret}`, { status: 401 }));
    vi.stubGlobal('fetch', outgoing);
    await expect(fetchXPost(app.env, 'alice', '123')).rejects.toEqual(
      new Error('Xの本文を取得できません（HTTP 401）。認証情報・閲覧権限を確認してください。'),
    );
    expect(outgoing).toHaveBeenCalledExactlyOnceWith(
      'https://api.x.com/2/tweets/123?tweet.fields=note_tweet',
      expect.objectContaining({
        redirect: 'manual',
        headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
      }),
    );
    const status = await app.request('/api/v1/integrations/x');
    const localState = await status.json();
    expect(localState).toEqual({
      configured: true,
      available: true,
      updated_at: expect.any(String),
    });
    expect(JSON.stringify(localState)).not.toContain(secret);
    expect((await app.request('/api/v1/integrations/x', { method: 'DELETE' })).status).toBe(200);
    await expect(fetchXPost(app.env, 'alice', '123')).rejects.toThrow('Bearer Tokenを登録');
    expect(outgoing).toHaveBeenCalledTimes(1);
    expect(
      await app.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM external_integrations WHERE provider='x'",
      ).first('n'),
    ).toBe(0);
    expect(await (await app.request('/api/v1/integrations/x')).json()).toEqual({
      configured: false,
      available: true,
      updated_at: null,
    });
  });
});

describe('B13 Push同意と配信の照合', () => {
  it('期限切れセッションの購読を登録時に掃除し、新しい所有者のセッションへ結び付ける', async () => {
    const { body } = await pushSetup();
    await app.env.DB.prepare(
      "UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE token_hash IN (SELECT session_hash FROM push_subscriptions)",
    ).run();
    expect(
      (await app.request('/api/v1/push/subscription', { method: 'PUT', user: 'bob', body })).status,
    ).toBe(200);
    expect(
      await app.env.DB.prepare(
        'SELECT p.user_id,p.session_hash=s.token_hash AS bound FROM push_subscriptions p JOIN sessions s ON s.user_id=p.user_id WHERE p.endpoint=?',
      )
        .bind(endpoint)
        .first(),
    ).toEqual({ user_id: 'bob', bound: 1 });
    expect(
      await (
        await app.request('/api/v1/push/status', {
          method: 'POST',
          user: 'bob',
          body: { endpoint },
        })
      ).json(),
    ).toEqual({ subscribed: true });
  });

  it('20端末に達しても本人の既存購読は更新でき、新規端末の拒否は購読を変えない', async () => {
    const { body } = await pushSetup();
    await app.env.DB.batch(
      Array.from({ length: 19 }, (_, index) =>
        app.env.DB.prepare(
          'INSERT INTO push_subscriptions(id,user_id,session_hash,endpoint,p256dh,auth) SELECT ?,user_id,session_hash,?,p256dh,auth FROM push_subscriptions WHERE endpoint=?',
        ).bind(crypto.randomUUID(), `${endpoint}-${index}`, endpoint),
      ),
    );
    expect((await app.request('/api/v1/push/subscription', { method: 'PUT', body })).status).toBe(
      200,
    );
    const snapshot = await app.env.DB.prepare('SELECT * FROM push_subscriptions ORDER BY id').all();
    expect(snapshot.results).toHaveLength(20);
    expect(
      (
        await app.request('/api/v1/push/subscription', {
          method: 'PUT',
          body: { ...body, endpoint: `${endpoint}-overflow` },
        })
      ).status,
    ).toBe(409);
    expect(
      (await app.env.DB.prepare('SELECT * FROM push_subscriptions ORDER BY id').all()).results,
    ).toEqual(snapshot.results);
  });

  it.each(['unsubscribe', 'logout', 'expiry', 'unpublish', 'disable', 'notify_at'] as const)(
    '暗号化後・送信直前の%sを再確認し、外部へ送信しない',
    async (change) => {
      const { item } = await pushSetup();
      const { encryptNotification: encrypt } = await vi.importActual<typeof webPush>(
        '@block65/webcrypto-web-push',
      );
      vi.spyOn(webPush, 'encryptNotification').mockImplementationOnce(async (...args) => {
        const encrypted = await encrypt(...args);
        if (change === 'unsubscribe') {
          expect(
            (
              await app.request('/api/v1/push/subscription', {
                method: 'DELETE',
                body: { endpoint },
              })
            ).status,
          ).toBe(200);
        } else if (change === 'logout') {
          expect((await app.request('/api/v1/logout', { method: 'POST', body: {} })).status).toBe(
            200,
          );
        } else if (change === 'expiry') {
          await app.env.DB.prepare(
            "UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z'",
          ).run();
        } else if (change === 'unpublish') {
          await app.env.DB.prepare(
            'UPDATE announcements SET published_at=NULL,notify=0,notify_at=NULL WHERE id=?',
          )
            .bind(item.id)
            .run();
        } else if (change === 'disable') {
          await app.env.DB.prepare('UPDATE announcements SET notify=0,notify_at=NULL WHERE id=?')
            .bind(item.id)
            .run();
        } else {
          await app.env.DB.prepare('UPDATE announcements SET notify_at=? WHERE id=?')
            .bind(new Date(Date.now() - 1000).toISOString(), item.id)
            .run();
        }
        return encrypted;
      });
      const outgoing = vi.fn(async () => new Response(null, { status: 201 }));
      vi.stubGlobal('fetch', outgoing);
      await deliverAnnouncements(app.env);
      expect(webPush.encryptNotification).toHaveBeenCalledTimes(1);
      expect(outgoing).not.toHaveBeenCalled();
      if (change === 'unsubscribe' || change === 'logout') {
        expect(
          await app.env.DB.prepare('SELECT COUNT(*) AS n FROM push_deliveries').first('n'),
        ).toBe(0);
      } else {
        expect(
          await app.env.DB.prepare('SELECT status,attempts FROM push_deliveries').first(),
        ).toEqual({ status: 'sending', attempts: 1 });
      }
    },
  );

  it('送信後にleaseが置き換わったとき、古い完了結果で新しい配信状態を上書きしない', async () => {
    await pushSetup();
    const outgoing = vi.fn(async () => {
      await app.env.DB.prepare(
        "UPDATE push_deliveries SET lease='replacement-worker',attempts=2,next_attempt_at=? WHERE status='sending'",
      )
        .bind(new Date(Date.now() + 120000).toISOString())
        .run();
      return new Response(null, { status: 201 });
    });
    vi.stubGlobal('fetch', outgoing);
    await deliverAnnouncements(app.env);
    expect(outgoing).toHaveBeenCalledTimes(1);
    expect(
      await app.env.DB.prepare('SELECT status,attempts,lease FROM push_deliveries').first(),
    ).toEqual({ status: 'sending', attempts: 2, lease: 'replacement-worker' });
  });

  it('5回目の送信leaseが期限切れなら失敗を確定し、6回目を送信しない', async () => {
    const { item } = await pushSetup();
    await app.env.DB.prepare(
      "INSERT INTO push_deliveries(announcement_id,subscription_id,status,attempts,lease,next_attempt_at) SELECT ?,id,'sending',5,'expired-worker','2000-01-01T00:00:00.000Z' FROM push_subscriptions",
    )
      .bind(item.id)
      .run();
    const outgoing = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', outgoing);
    await deliverAnnouncements(app.env);
    expect(outgoing).not.toHaveBeenCalled();
    expect(
      await app.env.DB.prepare('SELECT status,attempts,lease FROM push_deliveries').first(),
    ).toEqual({ status: 'failed', attempts: 5, lease: null });
  });
});
