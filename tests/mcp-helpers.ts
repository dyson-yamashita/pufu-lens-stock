import worker from '../server/index';
import type { testApp } from './helpers';
export const allMcpScopes = [
  'projects:read',
  'stocks:read',
  'stocks:write',
  'questions:read',
  'questions:write',
];
export async function mcpTokens(
  app: Awaited<ReturnType<typeof testApp>>,
  projectId: string | string[] | null = null,
  scopes = allMcpScopes,
  user = 'alice',
) {
  const request = (path: string, init: RequestInit = {}) =>
    worker.fetch(new Request(`${app.env.APP_URL}${path}`, init), app.env, app.ctx);
  const registered = await request('/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'MCP integration test',
      redirect_uris: ['https://chatgpt.com/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    }),
  });
  const { client_id } = (await registered.json()) as { client_id: string };
  const verifier = 'test-verifier-'.padEnd(64, 'a');
  const challenge = Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  ).toString('base64url');
  const params = new URLSearchParams({
    client_id,
    response_type: 'code',
    redirect_uri: 'https://chatgpt.com/callback',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: `${app.env.APP_URL}/mcp`,
    scope: scopes.join(' '),
  });
  const page = await request(`/oauth/authorize?${params}`, {
    headers: { Cookie: `stock_session=${user}-session` },
  });
  const html = await page.text();
  const handle = /name="handle" value="([^"]+)"/.exec(html)![1];
  const form = new URLSearchParams({ handle, decision: 'approve' });
  if (Array.isArray(projectId)) {
    form.set('project_access', 'selected');
    projectId.forEach((id) => form.append('project_id', id));
  } else form.set('project_id', projectId ?? '');
  scopes.forEach((scope) => form.append('scope', scope));
  const approved = await request('/oauth/authorize', {
    method: 'POST',
    headers: {
      Origin: app.env.APP_URL,
      Cookie: `stock_session=${user}-session; ${page.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ')}`,
    },
    body: form,
  });
  const code = new URL(approved.headers.get('Location')!).searchParams.get('code')!;
  const exchange = await request('/oauth/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id,
      redirect_uri: 'https://chatgpt.com/callback',
      code_verifier: verifier,
      resource: `${app.env.APP_URL}/mcp`,
    }),
  });
  if (!exchange.ok) throw new Error(await exchange.text());
  return {
    ...((await exchange.json()) as { access_token: string; refresh_token?: string }),
    client_id,
  };
}

export async function mcpToken(...args: Parameters<typeof mcpTokens>) {
  return (await mcpTokens(...args)).access_token;
}
