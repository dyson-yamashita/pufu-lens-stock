import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { isDemoOrigin } from '../../env';
import { demoLogin, googleCallback, googleConfigured, googleLogin } from '../../features/auth/auth';
import { readPufuImageLink } from '../../features/pufu/images/pufu-image-links';
import { observeOperation } from '../../infrastructure/diagnostics';
import { dispatchJobs } from '../../infrastructure/jobs/jobs';

export function registerPublicEndpointsRoutes(app: Hono<AppEnv>) {
  app.on(['GET', 'HEAD'], '/api/pufu-images/:token', async (c) => {
    const image = await readPufuImageLink(c.env, c.req.param('token'), c.req.method === 'HEAD');
    return new Response(image.body, {
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(image.size),
        'Content-Disposition': `${c.req.query('download') === '1' ? 'attachment' : 'inline'}; filename="pufu.png"`,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
        'Access-Control-Allow-Origin': '*',
      },
    });
  });

  app.get('/api/config', (c) => {
    const origin = new URL(c.req.url).origin;
    const demo = isDemoOrigin(c.env, origin);
    return c.json({
      demo,
      appUrl: demo ? origin : new URL(c.env.APP_URL).origin,
      googleConfigured: googleConfigured(c),
      aiEnabled: Boolean(c.env.AI),
      aiModel: c.env.AI ? c.env.AI_MODEL : null,
    });
  });

  app.get('/api/auth/google', googleLogin);

  app.get('/api/auth/google/callback', googleCallback);

  app.post('/api/auth/demo', async (c) => {
    const response = await demoLogin(c);
    c.executionCtx.waitUntil(
      observeOperation('background', 'dispatch_jobs', () => dispatchJobs(c.env)),
    );
    return response;
  });
}
