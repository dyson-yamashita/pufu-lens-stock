import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { stockImageMaxBytes } from '../../../shared/stock-images';
import type { AppEnv } from '../../env';
import { requestDiagnostics } from '../../infrastructure/diagnostics';

export function registerBaseMiddleware(app: Hono<AppEnv>) {
  app.use('*', requestDiagnostics('api'));

  app.use(
    '/api/*',
    (c, next) =>
      secureHeaders({
        crossOriginResourcePolicy: c.req.path.startsWith('/api/pufu-images/')
          ? 'cross-origin'
          : 'same-origin',
      })(c, next),
    (c, next) =>
      bodyLimit({
        maxSize:
          c.req.method === 'POST' && /^\/api\/v1\/stocks\/[^/]+\/images$/.test(c.req.path)
            ? stockImageMaxBytes
            : (c.req.method === 'PATCH' && /^\/api\/v1\/pufus\/[^/]+$/.test(c.req.path)) ||
                (c.req.method === 'POST' && c.req.path === '/api/v1/pufus') ||
                (c.req.method === 'POST' && /^\/api\/v1\/pufus\/[^/]+\/phases$/.test(c.req.path))
              ? 262144
              : c.req.method === 'POST' &&
                  (c.req.path === '/api/v1/stocks' ||
                    /^\/api\/v1\/stocks\/[^/]+\/retry$/.test(c.req.path))
                ? 163840
                : c.req.method === 'POST' &&
                    (/^\/api\/v1\/projects\/[^/]+\/pufus\/generate$/.test(c.req.path) ||
                      /^\/api\/v1\/questions\/[^/]+\/pufus$/.test(c.req.path))
                  ? 65536
                  : c.req.method === 'POST' && c.req.path === '/api/v1/feedback/manual-search'
                    ? 65536
                    : 16384,
        onError: (c) => c.json({ error: '送信内容が大きすぎます。' }, 413),
      })(c, next),
  );

  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
}
