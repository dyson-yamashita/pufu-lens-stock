import { createApp } from './api';
import { scheduledMaintenance } from './jobs';
import type { Env } from './env';
import { createMcpOAuthProvider } from './mcp-oauth';
import { handleMcp } from './mcp';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppEnv } from './env';
export { ArticleWorkflow, MemoryWorkflow } from './workflows';

const app = createApp();
const entry = new Hono<AppEnv>();
entry.use(
  '/mcp',
  bodyLimit({
    maxSize: 196608,
    onError: (c) => c.json({ error: '送信内容が大きすぎます。' }, 413),
  }),
);
entry.use(
  '/oauth/*',
  bodyLimit({ maxSize: 16384, onError: (c) => c.json({ error: '送信内容が大きすぎます。' }, 413) }),
);
entry.all('*', (c) => {
  if (!c.env.OAUTH_KV) {
    if (
      c.req.path === '/mcp' ||
      c.req.path.startsWith('/oauth/') ||
      c.req.path.startsWith('/api/v1/mcp/')
    )
      return c.json({ error: 'MCP連携を利用するには、管理者による設定が必要です。' }, 503);
    return app.fetch(c.req.raw, c.env, c.executionCtx);
  }
  return createMcpOAuthProvider(c.env, { fetch: handleMcp }, app).fetch(
    c.req.raw,
    c.env,
    c.executionCtx as ExecutionContext,
  );
});
export default {
  fetch: entry.fetch,
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(scheduledMaintenance(env));
  },
} satisfies ExportedHandler<Env>;
