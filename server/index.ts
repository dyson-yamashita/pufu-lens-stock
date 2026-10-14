import { createApp } from './api';
import { scheduledMaintenance } from './jobs';
import type { Env } from './env';
export { ArticleWorkflow, MemoryWorkflow } from './workflows';

const app = createApp();
export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(scheduledMaintenance(env));
  },
} satisfies ExportedHandler<Env>;
