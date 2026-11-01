import { createHash } from 'node:crypto';
import { expect } from 'e2e';
import { test } from '../src/fixtures.ts';

test('MCP-001 連携先の名前・プロジェクト・権限を編集して再読込後も保持する', async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  const { url } = fixture;
  const second = await fixture.request('/projects', 'POST', {
    name: 'E2E追加プロジェクト',
    description: '',
  });
  const registered = await fetch(`${url}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'E2E ChatGPT',
      redirect_uris: [`${url}/callback`],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    }),
  });
  expect(registered.ok).toBe(true);
  const { client_id } = (await registered.json()) as { client_id: string };
  const verifier = 'e2e-verifier-'.padEnd(64, 'a');
  const params = new URLSearchParams({
    client_id,
    response_type: 'code',
    redirect_uri: `${url}/callback`,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    resource: `${url}/mcp`,
    scope: 'projects:read stocks:read memories:read offline_access',
  });
  await app.open(`/oauth/authorize?${params}`);
  await expect(screen.getByLabel('プロジェクトのメモリを閲覧', { exact: true })).toBeChecked();
  await screen.getByLabel('選択したプロジェクト', { exact: true }).check();
  await screen.getByLabel(fixture.projectName, { exact: true }).check();
  await screen.getByLabel('E2E追加プロジェクト', { exact: true }).check();
  await screen.getByRole('button', '連携を許可', { exact: true }).click();
  await expect(browser.locator('.app-shell')).toBeVisible();
  await app.open('/#mcp');
  const row = browser.locator('.mcp-connections .token-row');
  await expect(row).toContainText('E2E ChatGPT');
  await screen.getByRole('button', '編集', { exact: true }).click();
  await screen.getByLabel('連携先の表示名').fill('仕事用ChatGPT');
  await expect(screen.getByLabel(fixture.projectName, { exact: true })).toBeChecked();
  await expect(screen.getByLabel('E2E追加プロジェクト', { exact: true })).toBeChecked();
  await screen.getByLabel('すべてのプロジェクト', { exact: true }).check();
  await screen.getByLabel('選択したプロジェクト', { exact: true }).check();
  await screen.getByLabel(fixture.projectName, { exact: true }).check();
  await screen.getByLabel('E2E追加プロジェクト', { exact: true }).check();
  await screen
    .getByLabel('ストックを検索・閲覧（本文・コメントを含む）', { exact: true })
    .uncheck();
  await expect(screen.getByLabel('プロジェクトのメモリを閲覧', { exact: true })).toBeChecked();
  await screen.getByLabel('プロジェクトのメモリを閲覧', { exact: true }).uncheck();
  await screen.getByRole('button', '保存', { exact: true }).click();
  await expect(row).toContainText('仕事用ChatGPT');
  await expect(row).toContainText(fixture.projectName);
  await browser.reload();
  await expect(row).toContainText('仕事用ChatGPT');
  await screen.getByRole('button', '編集', { exact: true }).click();
  await expect(screen.getByLabel('連携先の表示名')).toHaveValue('仕事用ChatGPT');
  await expect(screen.getByLabel(fixture.projectName, { exact: true })).toBeChecked();
  await expect(screen.getByLabel('E2E追加プロジェクト', { exact: true })).toBeChecked();
  await expect(
    screen.getByLabel('ストックを検索・閲覧（本文・コメントを含む）', { exact: true }),
  ).not.toBeChecked();
  await expect(screen.getByLabel('プロジェクトのメモリを閲覧', { exact: true })).not.toBeChecked();
  await screen.getByLabel('連携先の表示名').fill('保存しない名前');
  await screen.getByRole('button', 'キャンセル', { exact: true }).click();
  await expect(row).toContainText('仕事用ChatGPT');
  const { connections } = (await fixture.request('/mcp/connections')) as {
    connections: { id: string; client_name: string; project_ids: string[]; scopes: string[] }[];
  };
  expect(connections[0]).toMatchObject({
    client_name: '仕事用ChatGPT',
    project_ids: [fixture.projectId, second.id],
    scopes: ['projects:read', 'offline_access'],
  });
  await fixture.request(`/mcp/connections/${connections[0].id}`, 'DELETE');
  await fixture.request(`/projects/${second.id}`, 'DELETE');
});
