import * as oidc from 'openid-client';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';
import type { AppEnv, Principal } from './env';
import { isDemoOrigin } from './env';
import { hash, randomSecret } from './security';
import { now, dirtyMemoryStatements, queueQuestionStatements } from './db';
import { seedDemo } from './demo';
import { consumeMcpLogin } from './mcp-login';
import { cleanupDeletedAccounts } from './account';

const cookieName = (c: Context<AppEnv>) =>
  new URL(c.env.APP_URL).protocol === 'https:' ? '__Host-stock_session' : 'stock_session';
const oauthCookie = (c: Context<AppEnv>) =>
  new URL(c.env.APP_URL).protocol === 'https:' ? '__Host-stock_oauth' : 'stock_oauth';
const cookieOptions = (c: Context<AppEnv>) => ({
  httpOnly: true,
  secure: new URL(c.env.APP_URL).protocol === 'https:',
  sameSite: 'Lax' as const,
  path: '/',
});
export const googleConfigured = (c: Context<AppEnv>) =>
  Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET);
async function google(c: Context<AppEnv>): Promise<oidc.Configuration> {
  if (!googleConfigured(c))
    throw new HTTPException(503, {
      message: 'Google認証の設定が必要です。READMEの設定手順を確認してください。',
    });
  return oidc.discovery(
    new URL('https://accounts.google.com'),
    c.env.GOOGLE_CLIENT_ID!,
    c.env.GOOGLE_CLIENT_SECRET!,
    undefined,
    { execute: [oidc.enableNonRepudiationChecks] },
  );
}
export async function googleLogin(c: Context<AppEnv>) {
  const state = oidc.randomState();
  const verifier = oidc.randomPKCECodeVerifier();
  const nonce = oidc.randomNonce();
  const url = oidc.buildAuthorizationUrl(await google(c), {
    redirect_uri: `${c.env.APP_URL}/api/auth/google/callback`,
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
  });
  await c.env.DB.prepare(
    'INSERT INTO oauth_states (state_hash, code_verifier, nonce, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(await hash(state), verifier, nonce, new Date(Date.now() + 600000).toISOString())
    .run();
  setCookie(c, oauthCookie(c), state, { ...cookieOptions(c), maxAge: 600 });
  return c.redirect(url.href);
}
async function createSession(c: Context<AppEnv>, userId: string) {
  const token = randomSecret();
  const expires = new Date(Date.now() + 30 * 86400000);
  await c.env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await hash(token), userId, expires.toISOString())
    .run();
  setCookie(c, cookieName(c), token, { ...cookieOptions(c), expires });
}
export async function googleCallback(c: Context<AppEnv>) {
  const state = c.req.query('state');
  const code = c.req.query('code');
  const savedCookie = getCookie(c, oauthCookie(c));
  deleteCookie(c, oauthCookie(c), cookieOptions(c));
  if (!state || !code || state !== savedCookie) return c.redirect('/?login_error=1');
  const saved = await c.env.DB.prepare(
    'DELETE FROM oauth_states WHERE state_hash = ? AND expires_at > ? RETURNING code_verifier, nonce',
  )
    .bind(await hash(state), now())
    .first<{ code_verifier: string; nonce: string }>();
  if (!saved) return c.redirect('/?login_error=1');
  try {
    const tokens = await oidc.authorizationCodeGrant(await google(c), new URL(c.req.url), {
      pkceCodeVerifier: saved.code_verifier,
      expectedState: state,
      expectedNonce: saved.nonce,
    });
    const payload = tokens.claims();
    if (!payload) throw new Error('missing_identity');
    if (
      payload.nonce !== saved.nonce ||
      !payload.sub ||
      typeof payload.email !== 'string' ||
      payload.email_verified !== true
    )
      throw new Error('invalid_identity');
    const proposedId = crypto.randomUUID();
    await c.env.DB.prepare(
      'INSERT INTO users (id, google_sub, name, email, avatar_url) VALUES (?, ?, ?, ?, ?) ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, avatar_url = excluded.avatar_url',
    )
      .bind(
        proposedId,
        payload.sub,
        typeof payload.name === 'string' ? payload.name : payload.email,
        payload.email,
        typeof payload.picture === 'string' ? payload.picture : null,
      )
      .run();
    const user = await c.env.DB.prepare('SELECT id FROM users WHERE google_sub = ?')
      .bind(payload.sub)
      .first<{ id: string }>();
    await createSession(c, user!.id);
    return c.redirect((await consumeMcpLogin(c)) ?? '/');
  } catch {
    return c.redirect('/?login_error=1');
  }
}
export function assertSameOrigin(c: Context<AppEnv>) {
  const requestOrigin = new URL(c.req.url).origin;
  const expectedOrigin = isDemoOrigin(c.env, requestOrigin)
    ? requestOrigin
    : new URL(c.env.APP_URL).origin;
  if (c.req.header('Origin') !== expectedOrigin)
    throw new HTTPException(403, { message: 'この操作はアプリの画面から実行してください。' });
}
export async function demoLogin(c: Context<AppEnv>) {
  if (!isDemoOrigin(c.env, new URL(c.req.url).origin)) throw new HTTPException(404);
  assertSameOrigin(c);
  // ローカルでCronを実行していない場合も、前回の退会の後処理を進める。
  await cleanupDeletedAccounts(c.env);
  const demo = await seedDemo(c.env);
  if (demo.created)
    await c.env.DB.batch([
      ...dirtyMemoryStatements(c.env, demo.userId, demo.projectIds),
      ...queueQuestionStatements(c.env),
    ]);
  await createSession(c, demo.userId);
  return c.json({ ok: true });
}
export async function authenticate(c: Context<AppEnv>): Promise<Principal> {
  const authorization = c.req.header('Authorization');
  if (authorization) {
    const match = /^Bearer ([A-Za-z0-9_-]{20,160})$/i.exec(authorization);
    if (!match) throw new HTTPException(401, { message: 'Bearerトークンを確認してください。' });
    const token = await c.env.DB.prepare(
      'SELECT t.id AS token_id, t.project_id, u.id, u.name, u.bio, u.email, u.avatar_url FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > ?)',
    )
      .bind(await hash(match[1]), now())
      .first<{
        token_id: string;
        project_id: string | null;
        id: string;
        name: string;
        bio: string;
        email: string;
        avatar_url: string | null;
      }>();
    if (!token)
      throw new HTTPException(401, { message: 'トークンが無効、失効済み、または期限切れです。' });
    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?')
        .bind(now(), token.token_id)
        .run(),
    );
    return {
      user: {
        id: token.id,
        name: token.name,
        bio: token.bio,
        email: token.email,
        avatar_url: token.avatar_url,
      },
      kind: 'token',
      tokenProjectId: token.project_id,
    };
  }
  const cookie = getCookie(c, cookieName(c));
  const user = cookie
    ? await c.env.DB.prepare(
        'SELECT u.id, u.name, u.bio, u.email, u.avatar_url FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
      )
        .bind(await hash(cookie), now())
        .first<Principal['user']>()
    : null;
  if (!user) throw new HTTPException(401, { message: 'ログインが必要です。' });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) assertSameOrigin(c);
  return { user, kind: 'session', tokenProjectId: null };
}
export async function logout(c: Context<AppEnv>) {
  const cookie = getCookie(c, cookieName(c));
  if (cookie)
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await hash(cookie))
      .run();
  clearSessionCookies(c);
  return c.json({ ok: true });
}
export function clearSessionCookies(c: Context<AppEnv>) {
  deleteCookie(c, cookieName(c), cookieOptions(c));
  deleteCookie(c, oauthCookie(c), cookieOptions(c));
}
