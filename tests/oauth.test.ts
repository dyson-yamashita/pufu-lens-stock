import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testApp } from './helpers';
import type { User } from '../shared/domain';

const base64url = (value: Uint8Array) => Buffer.from(value).toString('base64url');
describe('Google OIDCのstate・nonce・署名検証（模擬Google応答）', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  let key: CryptoKeyPair;
  let nonce = '';
  let badNonce = false;
  let badSignature = false;
  let googleSub = 'google-alice';
  beforeEach(async () => {
    app = await testApp();
    app.env.GOOGLE_CLIENT_ID = 'test-client';
    app.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    nonce = '';
    badNonce = false;
    badSignature = false;
    googleSub = 'google-alice';
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
              name: 'Alice',
              email: 'alice@example.com',
              email_verified: true,
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
  it('編集した名前と自己紹介をGoogle再ログインで上書きしない', async () => {
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
      email: 'alice@example.com',
    });
  });
  it('初回ログインはGoogleの名前と空の自己紹介でプロフィールを作る', async () => {
    googleSub = 'google-new-user';
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
    expect(user).toMatchObject({ name: 'Alice', bio: '', email: 'alice@example.com' });
    expect(user.id).not.toBe('alice');
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
});
