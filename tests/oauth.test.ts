import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testApp } from './helpers';
import type { User } from '../shared/domain';
import { hash } from '../server/security';

const base64url = (value: Uint8Array) => Buffer.from(value).toString('base64url');
describe('Google OIDCのstate・nonce・署名検証（模擬Google応答）', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  let key: CryptoKeyPair;
  let nonce = '';
  let badNonce = false;
  let badSignature = false;
  let googleSub = 'google-alice';
  let extraProfile = false;
  beforeEach(async () => {
    app = await testApp();
    app.env.GOOGLE_CLIENT_ID = 'test-client';
    app.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    nonce = '';
    badNonce = false;
    badSignature = false;
    googleSub = 'google-alice';
    extraProfile = false;
    key = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );
    const publicKey = await crypto.subtle.exportKey('jwk', key.publicKey);
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const json = (data: unknown) =>
        new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
      if (url.hostname === 'accounts.google.com')
        return json({
          issuer: 'https://accounts.google.com',
          authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
          token_endpoint: 'https://oauth2.googleapis.com/token',
          jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
        });
      if (url.hostname === 'www.googleapis.com')
        return json({ keys: [{ ...publicKey, kid: 'test-key', alg: 'RS256', use: 'sig' }] });
      if (url.hostname === 'oauth2.googleapis.com') {
        const header = base64url(
          new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid: 'test-key' })),
        );
        const payload = base64url(
          new TextEncoder().encode(
            JSON.stringify({
              iss: 'https://accounts.google.com',
              aud: 'test-client',
              sub: googleSub,
              ...(extraProfile
                ? { name: 'Googleの本名', email: 'private@example.com', email_verified: true }
                : {}),
              nonce: badNonce ? 'wrong-nonce' : nonce,
              iat: Math.floor(Date.now() / 1000),
              exp: Math.floor(Date.now() / 1000) + 300,
            }),
          ),
        );
        const unsigned = `${header}.${payload}`;
        const signature = new Uint8Array(
          await crypto.subtle.sign(
            'RSASSA-PKCS1-v1_5',
            key.privateKey,
            new TextEncoder().encode(unsigned),
          ),
        );
        if (badSignature) signature[0] ^= 255;
        return json({
          access_token: 'test-access-token',
          token_type: 'Bearer',
          expires_in: 300,
          id_token: `${unsigned}.${base64url(signature)}`,
        });
      }
      return original(input, init);
    });
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.dispose();
  });
  async function login() {
    const response = await app.request('/api/auth/google');
    expect(response.status).toBe(302);
    const url = new URL(response.headers.get('Location')!);
    const state = url.searchParams.get('state')!;
    nonce = url.searchParams.get('nonce')!;
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('scope')).toBe('openid');
    return { state, headers: { Cookie: `stock_oauth=${state}` } };
  }
  it('正常な署名とnonceでログインし、subに対応したユーザーのセッションを作る', async () => {
    const { state, headers } = await login();
    const response = await app.request(`/api/auth/google/callback?state=${state}&code=test-code`, {
      headers,
    });
    expect(response.headers.get('Location')).toBe('/');
    const session = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('stock_session='))!;
    expect(session).toContain('HttpOnly');
    expect(session).toContain('SameSite=Lax');
    const identity = await app.request('/api/v1/me', {
      headers: { Cookie: session.split(';')[0] },
    });
    expect(((await identity.json()) as { user: { id: string } }).user.id).toBe('alice');
    const replay = await app.request(`/api/auth/google/callback?state=${state}&code=test-code`, {
      headers,
    });
    expect(replay.headers.get('Location')).toBe('/?login_error=1');
  });
  it('正しいstateでも異なるnonceを拒否する', async () => {
    const { state, headers } = await login();
    badNonce = true;
    const response = await app.request(`/api/auth/google/callback?state=${state}&code=test-code`, {
      headers,
    });
    expect(response.headers.get('Location')).toBe('/?login_error=1');
    expect(
      response.headers.getSetCookie().some((cookie) => cookie.startsWith('stock_session=')),
    ).toBe(false);
  });
  it('MCPから開始したログインは保存した認可要求に一度だけ復帰する', async () => {
    const target = `${app.env.APP_URL}/oauth/authorize?client_id=registered-client&state=mcp-state`;
    await app.env.OAUTH_KV!.put(`mcp-login:${await hash('browser-bound-handle')}`, target, {
      expirationTtl: 600,
    });
    const { state, headers } = await login();
    const response = await app.request(`/api/auth/google/callback?state=${state}&code=test-code`, {
      headers: { Cookie: `${headers.Cookie}; stock_mcp_login=browser-bound-handle` },
    });
    expect(response.headers.get('Location')).toBe(
      '/oauth/authorize?client_id=registered-client&state=mcp-state',
    );
    expect(
      await app.env.OAUTH_KV!.get(`mcp-login:${await hash('browser-bound-handle')}`),
    ).toBeNull();
    const next = await login();
    const expired = await app.request(
      `/api/auth/google/callback?state=${next.state}&code=test-code`,
      {
        headers: { Cookie: `${next.headers.Cookie}; stock_mcp_login=browser-bound-handle` },
      },
    );
    expect(expired.headers.get('Location')).toBe('/');
  });
  it('編集した名前と自己紹介をGoogle再ログインで上書きしない', async () => {
    extraProfile = true;
    expect(
      (
        await app.request('/api/v1/me', {
          method: 'PATCH',
          body: { name: '自分で決めた名前', bio: '自分の自己紹介' },
        })
      ).status,
    ).toBe(200);
    const { state, headers } = await login();
    const response = await app.request(`/api/auth/google/callback?state=${state}&code=test-code`, {
      headers,
    });
    expect(response.headers.get('Location')).toBe('/');
    const session = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('stock_session='))!;
    const identity = await app.request('/api/v1/me', {
      headers: { Cookie: session.split(';')[0] },
    });
    expect(((await identity.json()) as { user: User }).user).toMatchObject({
      id: 'alice',
      name: '自分で決めた名前',
      bio: '自分の自己紹介',
    });
  });
  it('初回ログインで余分な名前・メールが返っても利用せず、未登録の状態を作る', async () => {
    googleSub = 'google-new-user';
    extraProfile = true;
    const { state, headers } = await login();
    const response = await app.request(`/api/auth/google/callback?state=${state}&code=test-code`, {
      headers,
    });
    expect(response.headers.get('Location')).toBe('/');
    const session = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('stock_session='))!;
    const identity = await app.request('/api/v1/me', {
      headers: { Cookie: session.split(';')[0] },
    });
    const { user } = (await identity.json()) as { user: User };
    expect(user).toMatchObject({ name: '', bio: '', onboarding_completed_at: null });
    expect(user).not.toHaveProperty('email');
    expect(user.id).not.toBe('alice');
    const saved = await app.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(user.id).first();
    expect(JSON.stringify(saved)).not.toContain('private@example.com');
    expect(JSON.stringify(saved)).not.toContain('Googleの本名');
  });
  it('改ざんされたIDトークンの署名を拒否する', async () => {
    const { state, headers } = await login();
    badSignature = true;
    const response = await app.request(`/api/auth/google/callback?state=${state}&code=test-code`, {
      headers,
    });
    expect(response.headers.get('Location')).toBe('/?login_error=1');
    expect(
      response.headers.getSetCookie().some((cookie) => cookie.startsWith('stock_session=')),
    ).toBe(false);
  });
  it('未同意で再ログインしても登録を要求し、OK後はニックネームで利用できる', async () => {
    await app.env.DB.prepare(
      "UPDATE users SET name='',onboarding_completed_at=NULL WHERE id='alice'",
    ).run();
    const signIn = async () => {
      const { state, headers } = await login();
      const response = await app.request(
        `/api/auth/google/callback?state=${state}&code=test-code`,
        { headers },
      );
      return {
        Cookie: response.headers
          .getSetCookie()
          .find((cookie) => cookie.startsWith('stock_session='))!
          .split(';')[0],
      };
    };
    await signIn();
    const session = await signIn();
    const before = await app.request('/api/v1/me', { headers: session });
    expect(await before.json()).toMatchObject({
      user: { name: '', onboarding_completed_at: null },
    });
    expect((await app.request('/api/v1/projects', { headers: session })).status).toBe(403);
    expect(
      (
        await app.request('/api/v1/onboarding', {
          method: 'POST',
          headers: session,
          body: {
            name: 'ふくろう',
            terms_accepted: true,
            privacy_accepted: true,
            terms_version: '2026-10-30',
            privacy_version: '2026-10-30',
          },
        })
      ).status,
    ).toBe(200);
    const after = await app.request('/api/v1/me', { headers: await signIn() });
    expect(await after.json()).toMatchObject({
      user: { id: 'alice', name: 'ふくろう', onboarding_completed_at: expect.any(String) },
    });
  });
});
