import OAuthProvider, {
  AuthorizationError,
  CimdFetchError,
} from '@cloudflare/workers-oauth-provider';
import type { OAuthResourceContext, GrantSummary } from '@cloudflare/workers-oauth-provider';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit } from 'hono/body-limit';
import { getCookie } from 'hono/cookie';
import type { AppEnv, Env } from './env';
import { authenticate } from './auth';
import { rememberMcpLogin } from './mcp-login';
import { hash } from './security';
import { mcpScopes, type McpConnection } from '../shared/mcp';

export type McpGrantProps = { userId: string; projectId: string | null };
export type McpContext = OAuthResourceContext<McpGrantProps>;
const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function authorizationApp() {
  const app = new Hono<AppEnv>();
  app.use('*', bodyLimit({ maxSize: 16384 }), async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Frame-Options', 'DENY');
    c.header(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    await next();
  });
  app.get('/oauth/authorize', async (c) => {
    const oauth = c.env.OAUTH_PROVIDER!;
    const authRequest = await oauth.parseAuthRequest(c.req.raw);
    let principal;
    try {
      principal = await authenticate(c);
    } catch (error) {
      if (!(error instanceof HTTPException) || error.status !== 401) throw error;
      await rememberMcpLogin(c);
      return c.redirect('/api/auth/google');
    }
    if (principal.kind !== 'session') throw new HTTPException(403);
    const details = await oauth.describeConsent(authRequest);
    const consent = await oauth.beginConsent(authRequest);
    await c.env.OAUTH_KV!.put(`mcp-consent-user:${await hash(consent.handle)}`, principal.user.id, {
      expirationTtl: 600,
    });
    const projects = await c.env.DB.prepare(
      'SELECT id,name FROM projects WHERE user_id=? ORDER BY name,id',
    )
      .bind(principal.user.id)
      .all<{ id: string; name: string }>();
    const scopes = Object.entries(mcpScopes)
      .map(
        ([scope, label]) =>
          `<label class="permission"><input type="checkbox" name="scope" value="${scope}"${details.scope.includes(scope) ? ' checked' : ''}> ${label}</label>`,
      )
      .join('');
    const projectOptions = projects.results
      .map((project) => `<option value="${escape(project.id)}">${escape(project.name)}</option>`)
      .join('');
    for (const [name, value] of consent.headers) c.header(name, value);
    const preference = getCookie(c, 'pufu_lens_theme');
    const themeAttribute =
      preference === 'light' || preference === 'dark' ? ` data-theme="${preference}"` : '';
    return c.html(
      `<!doctype html><html lang="ja"${themeAttribute}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MCP連携の許可 | Pufu Lens</title><style>
:root{color-scheme:light;--text:#252c32;--page:#f8f9fa;--card:#fff;--border:#b7c0cc}
:root[data-theme="dark"]{color-scheme:dark;--text:#e5eaf3;--page:#101827;--card:#172033;--border:#667b98}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--text:#e5eaf3;--page:#101827;--card:#172033;--border:#667b98}}
body{font-family:system-ui,sans-serif;line-height:1.8;color:var(--text);background:var(--page);margin:0;padding:24px}main{max-width:560px;margin:32px auto;background:var(--card);padding:28px;border:1px solid var(--border);border-radius:16px}h1{font-size:24px}.permission{display:block;margin:12px 0}input,select,button{font:inherit}select{display:block;width:100%;padding:10px;margin:8px 0 20px}button{padding:10px 20px;cursor:pointer;margin:8px 8px 0 0}p{overflow-wrap:anywhere}small{display:block}
input,select,button{color:var(--text);background:var(--card);border:1px solid var(--border)}input[type="checkbox"]{accent-color:var(--text)}fieldset{border:1px solid var(--border)}
</style></head><body><main><p>Pufu Lens · MCP連携</p><h1>${escape(details.clientName)}との連携を許可</h1><p>${escape(principal.user.name)}として接続します。</p><p>${details.clientDomain ? `クライアントのドメイン: ${escape(details.clientDomain)}` : 'クライアント名は接続元が登録した名称です。'}<br>認可結果の送信先: <strong>${escape(details.redirectHost)}</strong></p>${details.redirectIsLoopback ? '<p>このコンピューター上のアプリへ接続します。自分で開始した接続であることを確認してください。</p>' : ''}<form method="post" action="/oauth/authorize"><input type="hidden" name="handle" value="${escape(consent.handle)}"><fieldset><legend>許可する操作</legend>${scopes}</fieldset><p><label for="project">アクセスを許可するプロジェクト</label><select id="project" name="project_id"><option value="">すべてのプロジェクト</option>${projectOptions}</select><small>選択した範囲のデータが接続先で利用されます。</small></p><button name="decision" value="approve">連携を許可</button><button name="decision" value="deny">許可しない</button></form></main></body></html>`,
    );
  });
  app.post('/oauth/authorize', async (c) => {
    const principal = await authenticate(c);
    if (principal.kind !== 'session') throw new HTTPException(403);
    const form = await c.req.parseBody({ all: true });
    const handle = typeof form.handle === 'string' ? form.handle : '';
    const key = `mcp-consent-user:${await hash(handle)}`;
    if ((await c.env.OAUTH_KV!.get(key)) !== principal.user.id)
      throw new HTTPException(403, {
        message: '認可画面を開いたアカウントで、接続をやり直してください。',
      });
    const oauth = c.env.OAUTH_PROVIDER!;
    if (form.decision !== 'approve') {
      const denied = await oauth.denyConsent(c.req.raw, handle);
      await c.env.OAUTH_KV!.delete(key);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const projectId =
      typeof form.project_id === 'string' && form.project_id ? form.project_id : null;
    const project = projectId
      ? await c.env.DB.prepare('SELECT id,name FROM projects WHERE id=? AND user_id=?')
          .bind(projectId, principal.user.id)
          .first<{ id: string; name: string }>()
      : null;
    if (projectId && !project)
      throw new HTTPException(404, { message: 'プロジェクトが見つかりません。' });
    const scope = (Array.isArray(form.scope) ? form.scope : [form.scope]).filter(
      (value): value is string => typeof value === 'string',
    );
    const approved = await oauth.approveConsent(c.req.raw, handle, { scope });
    await c.env.OAUTH_KV!.delete(key);
    const details = await oauth.describeConsent(approved.request);
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: principal.user.id,
      scope: approved.request.scope,
      metadata: {
        client_name: details.clientName,
        project_id: projectId,
        project_name: project?.name ?? null,
      },
      props: { userId: principal.user.id, projectId } satisfies McpGrantProps,
    });
    approved.headers.set('Location', redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  });
  app.use('/api/v1/mcp/*', async (c, next) => {
    const principal = await authenticate(c);
    if (principal.kind !== 'session') throw new HTTPException(403);
    c.set('principal', principal);
    await next();
  });
  const grants = async (c: import('hono').Context<AppEnv>) => {
    const result: GrantSummary[] = [];
    let cursor: string | undefined;
    do {
      const page = await c.env.OAUTH_PROVIDER!.listUserGrants(c.get('principal').user.id, {
        cursor,
        limit: 100,
      });
      result.push(...page.items);
      cursor = page.cursor;
    } while (cursor);
    return result;
  };
  app.get('/api/v1/mcp/connections', async (c) =>
    c.json({
      enabled: !!c.env.OAUTH_PROVIDER,
      url: `${c.env.APP_URL}/mcp`,
      connections: (c.env.OAUTH_PROVIDER ? await grants(c) : []).map(
        (grant) =>
          ({
            id: grant.id,
            client_name: grant.metadata?.client_name ?? 'MCPクライアント',
            project_id: grant.metadata?.project_id ?? null,
            project_name: grant.metadata?.project_name ?? null,
            scopes: grant.scope,
            created_at: new Date(grant.createdAt * 1000).toISOString(),
            expires_at: grant.expiresAt ? new Date(grant.expiresAt * 1000).toISOString() : null,
          }) satisfies McpConnection,
      ),
    }),
  );
  app.delete('/api/v1/mcp/connections/:id', async (c) => {
    const id = c.req.param('id');
    if (!(await grants(c)).some((grant) => grant.id === id)) throw new HTTPException(404);
    await c.env.OAUTH_PROVIDER!.revokeGrant(id, c.get('principal').user.id);
    return c.json({ ok: true });
  });
  app.onError((error, c) => {
    if (error instanceof AuthorizationError && error.redirectTo)
      return c.redirect(error.redirectTo);
    if (error instanceof AuthorizationError || error instanceof CimdFetchError)
      return c.json({ error: '認可要求が無効か期限切れです。接続先からやり直してください。' }, 400);
    if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
    console.error('MCP authorization failed', error);
    return c.json({ error: '連携の認可処理に失敗しました。' }, 500);
  });
  return app;
}
export const mcpAuthorizationApp = authorizationApp();

export function createMcpOAuthProvider(
  env: Env,
  apiHandler: {
    fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
  },
  fallback: typeof mcpAuthorizationApp,
) {
  return new OAuthProvider<Env>({
    apiRoute: '/mcp',
    apiHandler,
    authorizeEndpoint: '/oauth/authorize',
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register',
    clientRegistrationTTL: undefined,
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: Object.keys(mcpScopes),
    requiredScopes: Object.keys(mcpScopes),
    accessTokenTTL: 3600,
    refreshTokenTTL: 30 * 86400,
    tokenExchangeCallback: async ({ scope }) => ({
      refreshTokenTTL: scope.includes('offline_access') ? 30 * 86400 : 0,
    }),
    resourceMetadata: { resource: `${env.APP_URL}/mcp`, authorization_servers: [env.APP_URL] },
    defaultHandler: {
      fetch(request, bindings, ctx) {
        const path = new URL(request.url).pathname;
        return path.startsWith('/oauth/') || path.startsWith('/api/v1/mcp/')
          ? mcpAuthorizationApp.fetch(request, bindings, ctx)
          : fallback.fetch(request, bindings, ctx);
      },
    },
  });
}
