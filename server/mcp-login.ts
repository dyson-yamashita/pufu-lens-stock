import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { AppEnv } from './env';
import { hash, randomSecret } from './security';

const loginCookie = (c: Context<AppEnv>) =>
  `${new URL(c.env.APP_URL).protocol === 'https:' ? '__Host-' : ''}stock_mcp_login`;
const options = (c: Context<AppEnv>) => ({
  httpOnly: true,
  secure: new URL(c.env.APP_URL).protocol === 'https:',
  sameSite: 'Lax' as const,
  path: '/',
});

export async function rememberMcpLogin(c: Context<AppEnv>) {
  const secret = randomSecret();
  await c.env.OAUTH_KV!.put(`mcp-login:${await hash(secret)}`, c.req.url, { expirationTtl: 600 });
  setCookie(c, loginCookie(c), secret, { ...options(c), maxAge: 600 });
}

export async function consumeMcpLogin(c: Context<AppEnv>): Promise<string | null> {
  const secret = getCookie(c, loginCookie(c));
  if (!secret) return null;
  deleteCookie(c, loginCookie(c), options(c));
  if (!c.env.OAUTH_KV) return null;
  const key = `mcp-login:${await hash(secret)}`;
  const saved = await c.env.OAUTH_KV.get(key);
  await c.env.OAUTH_KV.delete(key);
  if (!saved) return null;
  const url = new URL(saved);
  return url.origin === new URL(c.env.APP_URL).origin && url.pathname === '/oauth/authorize'
    ? `${url.pathname}${url.search}`
    : null;
}
