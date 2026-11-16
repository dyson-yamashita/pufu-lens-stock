import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import type { User } from '../../shared/domain';
import { resolveLanguage, translate } from '../../shared/locale';
import type { Env, Principal } from '../env';
import { allowedProjectIds } from '../features/projects/project-access';
import { getMcpConnectionSettings } from './connection-settings';
import type { McpContext } from './oauth';
import { createToolContext } from './tool-context';
import { id } from './tool-schemas';
import { registerCommentsTools } from './tools/comments';
import { registerGuidelineTools } from './tools/guideline';
import { registerMemoryTools } from './tools/memory';
import { registerProjectsTools } from './tools/projects';
import { registerPufuTools } from './tools/pufu';
import { registerQuestionReadTools } from './tools/question-read';
import { registerQuestionWriteTools } from './tools/question-write';
import { registerStocksTools } from './tools/stocks';
function createServer(env: Env, ctx: McpContext, principal: Principal) {
  const context = createToolContext(env, ctx, principal);
  registerGuidelineTools(context);
  registerCommentsTools(context);
  registerProjectsTools(context);
  registerMemoryTools(context);
  registerStocksTools(context);
  registerQuestionReadTools(context);
  registerPufuTools(context);
  registerQuestionWriteTools(context);
  context.server.server.setRequestHandler('tools/list', async () => ({
    tools: context.exposedTools,
  }));
  return context.server;
}

export async function handleMcp(request: Request, env: Env, executionCtx: ExecutionContext) {
  const ctx = executionCtx as McpContext;
  const parsed = z
    .object({ userId: id, projectId: id.nullable(), projectIds: z.array(id).nullable().optional() })
    .safeParse(ctx.props);
  if (!parsed.success || !ctx.auth) return new Response('認証が必要です。', { status: 401 });
  const user = await env.DB.prepare(
    'SELECT id,name,bio,onboarding_completed_at,avatar_url,language FROM users WHERE id=?',
  )
    .bind(parsed.data.userId)
    .first<User>();
  if (!user) return new Response('ユーザーが見つかりません。', { status: 401 });
  const t = (message: string) => translate(resolveLanguage(user.language), message);
  if (!user.onboarding_completed_at)
    return new Response(t('Web画面でニックネームの登録と規約への同意を完了してください。'), {
      status: 403,
    });
  // Resolve the grant through the provider; never trust a client-supplied grant ID.
  const token = await env.OAUTH_PROVIDER?.unwrapToken(ctx.auth.token);
  if (!token || token.userId !== user.id)
    return new Response(t('認証が必要です。'), { status: 401 });
  const settings = await getMcpConnectionSettings(env, user.id, token.grantId);
  if (settings?.revoked) return new Response(t('認証が必要です。'), { status: 401 });
  if (settings) {
    const allowed = JSON.parse(settings.scopes) as string[];
    ctx.auth.scope = ctx.auth.scope.filter((scope) => allowed.includes(scope));
  }
  const principal: Principal = {
    user,
    kind: 'mcp',
    tokenProjectId: null,
    tokenProjectIds: settings
      ? settings.project_ids === null
        ? settings.project_id
          ? [settings.project_id]
          : null
        : (JSON.parse(settings.project_ids) as string[])
      : parsed.data.projectIds === undefined
        ? parsed.data.projectId
          ? [parsed.data.projectId]
          : null
        : parsed.data.projectIds,
  };
  const permitted = allowedProjectIds(principal);
  if (permitted !== null) {
    const existing = await env.DB.prepare(
      'SELECT id FROM projects WHERE user_id=? AND id IN (SELECT value FROM json_each(?))',
    )
      .bind(user.id, JSON.stringify(permitted))
      .all<{ id: string }>();
    if (!existing.results.length)
      return new Response(t('許可されたプロジェクトが見つかりません。'), { status: 403 });
    principal.tokenProjectIds = existing.results.map((project) => project.id);
  }
  const handler = createMcpHandler(() => createServer(env, ctx, principal), {
    corsOptions: false,
    allowedHostnames: [new URL(env.APP_URL).hostname],
    allowedOriginHostnames: [new URL(env.APP_URL).hostname, 'chatgpt.com'],
  });
  return handler(request, env, ctx);
}
