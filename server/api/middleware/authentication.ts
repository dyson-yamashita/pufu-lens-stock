import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv, Principal } from '../../env';
import { authenticate } from '../../features/auth/auth';

export function registerAuthentication(app: Hono<AppEnv>, trustedPrincipal?: Principal) {
  app.use('/api/v1/*', async (c, next) => {
    const principal = trustedPrincipal ?? (await authenticate(c));
    c.set('principal', principal);
    if (
      !principal.user.onboarding_completed_at &&
      !(
        principal.kind === 'session' &&
        ((c.req.path === '/api/v1/me' && ['GET', 'DELETE'].includes(c.req.method)) ||
          (c.req.method === 'POST' &&
            ['/api/v1/onboarding', '/api/v1/logout'].includes(c.req.path)))
      )
    )
      throw new HTTPException(403, {
        message: 'ニックネームの登録と利用規約・プライバシーポリシーへの同意を完了してください。',
      });
    if (
      principal.kind === 'mcp' &&
      !(
        (c.req.method === 'GET' &&
          /^\/api\/v1\/(comments|projects|memory(?:\/history(?:\/[^/]+)?)?|stocks|stocks\/[^/]+(?:\/(?:content|images))?|pufus|questions|questions\/[^/]+(?:\/pufu(?:\/[^/]+(?:\/image)?)?)?)$/.test(
            c.req.path,
          )) ||
        (c.req.method === 'POST' && /^\/api\/v1\/stocks\/[^/]+\/images$/.test(c.req.path)) ||
        (c.req.method === 'POST' &&
          ['/api/v1/comments', '/api/v1/stocks', '/api/v1/questions', '/api/v1/pufus'].includes(
            c.req.path,
          )) ||
        (c.req.method === 'PATCH' && /^\/api\/v1\/pufus\/[^/]+$/.test(c.req.path))
      )
    )
      throw new HTTPException(403);
    if (
      principal.kind === 'token' &&
      !(
        (c.req.method === 'GET' && c.req.path === '/api/v1/projects') ||
        (c.req.method === 'POST' && c.req.path === '/api/v1/stocks')
      )
    )
      throw new HTTPException(403, { message: 'このトークンには操作の権限がありません。' });
    await next();
  });
}
