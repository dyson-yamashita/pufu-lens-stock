import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './helpers';
import { isDemoOrigin } from '../server/env';

describe('同じWi-Fiからのローカルデモ', () => {
  const lanOrigin = 'http://192.168.10.109:5173';
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
    app.env.LOCAL_DEMO_ENABLED = 'true';
    app.env.LOCAL_DEMO_LAN_ORIGIN = lanOrigin;
  });
  afterEach(async () => {
    await app.dispose();
  });

  it('許可したLANアドレスからログインし、セッションで取得と保存ができる', async () => {
    const config = await app.request('/api/config', { host: lanOrigin });
    expect(((await config.json()) as { demo: boolean }).demo).toBe(true);
    const login = await app.request('/api/auth/demo', {
      method: 'POST',
      host: lanOrigin,
      headers: { Origin: lanOrigin, Cookie: '' },
    });
    expect(login.status).toBe(200);
    const cookie = login.headers
      .getSetCookie()
      .find((value) => value.startsWith('stock_session='))!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    const headers = { Origin: lanOrigin, Cookie: cookie.split(';')[0] };
    const identity = await app.request('/api/v1/me', { host: lanOrigin, headers });
    expect(identity.status).toBe(200);
    expect(await identity.json()).toMatchObject({ demo: true, user: { id: expect.any(String) } });
    const { projects } = (await (
      await app.request('/api/v1/projects', { host: lanOrigin, headers })
    ).json()) as { projects: { id: string }[] };
    expect(
      (
        await app.request('/api/v1/stocks', {
          method: 'POST',
          host: lanOrigin,
          headers,
          body: { project_id: projects[0].id, url: 'https://example.com/from-phone' },
        })
      ).status,
    ).toBe(202);
    expect((await app.request('/api/v1/questions', { host: lanOrigin, headers })).status).toBe(200);
  });
  it('LANでもリクエスト先と異なるOriginからのログイン・変更を拒否する', async () => {
    for (const Origin of ['', app.env.APP_URL, 'https://evil.example.com']) {
      expect(
        (
          await app.request('/api/auth/demo', {
            method: 'POST',
            host: lanOrigin,
            headers: { Origin },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await app.request('/api/v1/me', {
            method: 'PATCH',
            host: lanOrigin,
            headers: { Origin },
            body: { name: '変更', bio: '' },
          })
        ).status,
      ).toBe(403);
    }
  });
  it('設定していないLANアドレスと公開アドレスではデモを許可しない', async () => {
    for (const origin of [
      'http://192.168.10.110:5173',
      'http://10.0.0.1:5173',
      'https://production.example.com',
    ]) {
      expect(isDemoOrigin(app.env, origin)).toBe(false);
      expect(
        (
          await app.request('/api/auth/demo', {
            method: 'POST',
            host: origin,
            headers: { Origin: origin },
          })
        ).status,
      ).toBe(404);
      expect(await (await app.request('/api/config', { host: origin })).json()).toMatchObject({
        demo: false,
      });
    }
    app.env.LOCAL_DEMO_LAN_ORIGIN = 'http://8.8.8.8:5173';
    expect(isDemoOrigin(app.env, app.env.LOCAL_DEMO_LAN_ORIGIN)).toBe(false);
  });
  it('本番設定やデモ無効時にLAN用設定だけでログインを許可しない', () => {
    app.env.LOCAL_DEMO_ENABLED = 'false';
    expect(isDemoOrigin(app.env, lanOrigin)).toBe(false);
    app.env.LOCAL_DEMO_ENABLED = 'true';
    app.env.APP_URL = 'https://stock.example.com';
    expect(isDemoOrigin(app.env, lanOrigin)).toBe(false);
  });
  it('localhostとループバックは利用でき、別ポート・別プロトコル・不正Originを拒否する', () => {
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173'])
      expect(isDemoOrigin(app.env, origin)).toBe(true);
    for (const origin of [
      'http://192.168.10.109:5174',
      'https://192.168.10.109:5173',
      'http://192.168.10.109:5173/path',
      'invalid',
    ])
      expect(isDemoOrigin(app.env, origin)).toBe(false);
  });
});
