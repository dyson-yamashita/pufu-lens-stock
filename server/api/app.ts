import { Hono } from 'hono';
import type { AppEnv, Principal } from '../env';
import { pushApp } from '../features/announcements/push';
import { feedbackApp } from '../features/feedback/feedback';
import { publicProjectsApp, publicationApp } from '../features/public-projects/public-projects';
import { stockImagesApp } from '../features/stocks/stock-images';
import { registerAuthentication } from './middleware/authentication';
import { registerBaseMiddleware } from './middleware/base';
import { registerApiErrors } from './middleware/errors';
import { registerAccountRoutes } from './routes/account';
import { registerAnnouncementsRoutes } from './routes/announcements';
import { registerCommentsRoutes } from './routes/comments';
import { registerIntegrationsRoutes } from './routes/integrations';
import { registerMemoryRoutes } from './routes/memory';
import { registerProjectsRoutes } from './routes/projects';
import { registerPublicEndpointsRoutes } from './routes/public-endpoints';
import { registerPufuRoutes } from './routes/pufu';
import { registerQuestionCollectionRoutes } from './routes/question-collection';
import { registerQuestionDetailsRoutes } from './routes/question-details';
import { registerStockCollectionRoutes } from './routes/stock-collection';
import { registerStockDetailsRoutes } from './routes/stock-details';
import { registerTokensRoutes } from './routes/tokens';

// OAuth検証済みユーザーによるプロセス内MCP呼び出しでのみprincipalを指定する。
export function createApp(trustedPrincipal?: Principal) {
  const app = new Hono<AppEnv>();
  registerBaseMiddleware(app);
  app.route('/api/public', publicProjectsApp());
  registerPublicEndpointsRoutes(app);
  registerAuthentication(app, trustedPrincipal);
  app.route('/api/v1/push', pushApp());
  registerAnnouncementsRoutes(app);
  app.route('/api/v1/projects', publicationApp());
  app.route('/api/v1/feedback', feedbackApp());
  app.route('/api/v1/stocks/:id/images', stockImagesApp());
  registerCommentsRoutes(app);
  registerIntegrationsRoutes(app);
  registerAccountRoutes(app);
  registerProjectsRoutes(app);
  registerStockCollectionRoutes(app);
  registerQuestionDetailsRoutes(app);
  registerPufuRoutes(app);
  registerQuestionCollectionRoutes(app);
  registerStockDetailsRoutes(app);
  registerMemoryRoutes(app);
  registerTokensRoutes(app);
  registerApiErrors(app);
  return app;
}
