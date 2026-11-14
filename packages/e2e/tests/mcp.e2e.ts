import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
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
  // A real second loopback server also receives browser redirect requests, which bypass route mocks.
  const callbackServer = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('MCP callback received');
  });
  await new Promise<void>((resolve, reject) => {
    callbackServer.once('error', reject);
    callbackServer.listen(0, '127.0.0.1', resolve);
  });
  const address = callbackServer.address();
  if (!address || typeof address === 'string') throw new Error('コールバックURLを取得できません。');
  const callback = new URL(`http://127.0.0.1:${address.port}/callback`);
  const redirectUri = callback.href;
  try {
    const registered = await fetch(`${url}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'E2E ChatGPT',
        redirect_uris: [redirectUri],
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
      redirect_uri: redirectUri,
      state: 'e2e-mcp-state',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      resource: `${url}/mcp`,
      scope: 'projects:read stocks:read memories:read offline_access',
    });
    await app.open(`/oauth/authorize?${params}`);
    // Exercise the real consent response and its CSP, including theme-specific assets.
    for (const theme of ['light', 'dark'] as const) {
      await browser.emulateMedia({ colorScheme: theme });
      const branding = await browser.evaluate(async () => {
        await Promise.all(Array.from(document.images, (image) => image.decode()));
        const visibleLogo = Array.from(
          document.querySelectorAll<HTMLImageElement>('.brand-logo'),
        ).find((image) => getComputedStyle(image).display !== 'none');
        const mark = document.querySelector<HTMLImageElement>('.brand-mark');
        return {
          logo: visibleLogo?.getAttribute('src') ?? null,
          loaded:
            !!visibleLogo?.complete &&
            visibleLogo.naturalWidth > 0 &&
            !!mark?.complete &&
            mark.naturalWidth > 0,
          fitsViewport: document.documentElement.scrollWidth <= window.innerWidth,
        };
      });
      expect(branding).toEqual({
        logo: theme === 'dark' ? '/pufu-lens-wordmark-dark.svg' : '/pufu-lens-wordmark.svg',
        loaded: true,
        fitsViewport: true,
      });
      await app.screenshot(`mcp-consent-${theme}`);
    }
    await browser.emulateMedia({ colorScheme: 'light' });
    await expect(screen.getByLabel('プロジェクトのメモリを閲覧', { exact: true })).toBeChecked();
    await screen.getByLabel('選択したプロジェクト', { exact: true }).check();
    await expect(browser.locator('button.approve')).not.toBeVisible();
    await expect(browser.locator('button.selection-required')).toBeDisabled();
    await screen.getByLabel(fixture.projectName, { exact: true }).check();
    await expect(browser.locator('button.approve')).toBeVisible();
    await screen.getByLabel('E2E追加プロジェクト', { exact: true }).check();
    await screen.getByRole('button', '連携を許可', { exact: true }).click();
    await expect(screen.getByText('MCP callback received', { exact: true })).toBeVisible();
    const approvedCallback = new URL(await browser.evaluate(() => location.href));
    expect(approvedCallback.origin).toBe(callback.origin);
    expect(approvedCallback.searchParams.get('code')).toBeTruthy();
    expect(approvedCallback.searchParams.get('state')).toBe('e2e-mcp-state');
    await app.open(`/oauth/authorize?${params}`);
    await screen.getByRole('button', '許可しない', { exact: true }).click();
    await expect(screen.getByText('MCP callback received', { exact: true })).toBeVisible();
    const deniedCallback = new URL(await browser.evaluate(() => location.href));
    expect(deniedCallback.origin).toBe(callback.origin);
    expect(deniedCallback.searchParams.get('error')).toBe('access_denied');
    expect(deniedCallback.searchParams.get('state')).toBe('e2e-mcp-state');
    await app.open('/#mcp');
    await expect(screen.getByRole('heading', '外部連携', { exact: true })).toBeVisible();
    await expect(
      browser.locator('.sidebar .nav-item').filter({ hasText: 'ショートカット連携' }),
    ).toHaveCount(0);
    const menu = screen.getByRole('button', 'メニューを開く', { exact: true });
    if (await menu.isVisible()) await menu.click();
    await screen.getByRole('button', '外部連携', { exact: true }).click();
    const tabs = browser.locator('.integration-tabs');
    const panel = screen.getByRole('tabpanel');
    await expect(tabs.getByRole('tab')).toHaveText(['ショートカット', 'MCP', 'SNS']);
    await expect(tabs.getByRole('tab', 'ショートカット', { exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(panel.getByRole('heading', '共有メニューから、記事をストック。')).toBeVisible();
    await expect(browser.locator('#mcp-url, #x-token')).toHaveCount(0);
    await screen.getByRole('button', 'トークンを発行', { exact: true }).click();
    const shortcutName = `E2Eショートカット-${fixture.projectId}`;
    await screen.getByLabel('トークン名', { exact: true }).fill(shortcutName);
    await screen.getByRole('button', '発行する', { exact: true }).click();
    await expect(
      screen.getByRole('heading', 'トークンを発行しました', { exact: true }),
    ).toBeVisible();
    await screen.getByRole('button', '閉じる', { exact: true }).click();
    const tokenRow = browser.locator('.token-row').filter({ hasText: shortcutName });
    await expect(tokenRow).toBeVisible();
    const accept = await browser.onDialog(async (dialog) => {
      expect(dialog.type).toBe('confirm');
      await dialog.accept();
    });
    await tokenRow.getByRole('button', '失効する', { exact: true }).click();
    await expect(tokenRow).toContainText('失効済み');
    await accept();
    for (const label of ['ショートカット', 'MCP', 'SNS']) {
      await tabs.getByRole('tab', label, { exact: true }).click();
      await expect(tabs.getByRole('tab', label, { exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(
        await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await app.screenshot(`integrations-${label}-light`);
      await browser.emulateMedia({ colorScheme: 'dark' });
      await app.screenshot(`integrations-${label}-dark`);
      await browser.emulateMedia({ colorScheme: 'light' });
    }
    await expect(screen.getByLabel('X API Bearer Token', { exact: true })).toBeVisible();
    await expect(panel).toContainText('未登録');
    await expect(browser.locator('#mcp-url, #shortcut-project')).toHaveCount(0);
    await browser.reload();
    await expect(tabs.getByRole('tab', 'SNS', { exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(screen.getByLabel('X API Bearer Token', { exact: true })).toBeVisible();
    await tabs.getByRole('tab', 'SNS', { exact: true }).click();
    for (const [key, label] of [
      ['ArrowRight', 'ショートカット'],
      ['ArrowLeft', 'SNS'],
      ['Home', 'ショートカット'],
      ['End', 'SNS'],
      ['ArrowLeft', 'MCP'],
    ]) {
      await browser.keyboard.press(key);
      await expect(tabs.getByRole('tab', label, { exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(await browser.evaluate(() => document.activeElement?.textContent ?? null)).toBe(label);
    }
    await browser.back();
    await expect(tabs.getByRole('tab', 'SNS', { exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await browser.evaluate(() => document.activeElement?.textContent ?? null)).toBe('SNS');
    await browser.forward();
    await expect(tabs.getByRole('tab', 'MCP', { exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await browser.evaluate(() => document.activeElement?.textContent ?? null)).toBe('MCP');
    await expect(browser.locator('#x-token, #shortcut-project')).toHaveCount(0);
    const integration = browser.locator('section[aria-labelledby="mcp-integration-heading"]');
    await expect(integration.getByRole('heading', '接続中のサービス')).toBeVisible();
    await expect(screen.getByRole('heading', '対話でプ譜づくりを支援する')).toBeVisible();
    const skillLinks = browser.locator('.skill-links li');
    await expect(skillLinks).toHaveCount(2);
    await expect(skillLinks.first().getByRole('link', 'スキルのインストール方法')).toHaveAttribute(
      'href',
      '/manual#skills',
    );
    await expect(skillLinks.last().getByRole('link', '配布スキル一覧（GitHub）')).toHaveAttribute(
      'href',
      'https://github.com/dyson-yamashita/pufu-lens-stock/tree/main/skills',
    );
    const row = browser.locator('.mcp-integration .mcp-connections .token-row');
    await expect(row).toContainText('E2E ChatGPT');
    const layout = await browser.evaluate(() => {
      const mcp = document.querySelector('.mcp-integration')!.getBoundingClientRect();
      const skills = document
        .querySelector('.skill-links')!
        .closest('section')!
        .getBoundingClientRect();
      const links = Array.from(document.querySelectorAll('.skill-links li'), (link) =>
        link.getBoundingClientRect(),
      );
      return {
        servicesBeforeSkills: mcp.bottom <= skills.top,
        linksStacked: links[0].bottom <= links[1].top,
        fitsViewport: document.documentElement.scrollWidth <= window.innerWidth,
      };
    });
    expect(layout).toEqual({
      servicesBeforeSkills: true,
      linksStacked: true,
      fitsViewport: true,
    });
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
    await expect(
      screen.getByLabel('プロジェクトのメモリを閲覧', { exact: true }),
    ).not.toBeChecked();
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
    await screen.getByRole('link', 'スキルのインストール方法').click();
    await expect(browser.locator('#skills')).toBeVisible();
    await screen.getByText('インストールとMCP接続', { exact: true }).click();
    await expect(browser.locator('#skills pre').first()).toContainText(
      'npx skills add https://github.com/dyson-yamashita/pufu-lens-stock/tree/main/skills --skill deepen-questions -g',
    );
    await expect(browser.locator('#skills pre').nth(1)).toContainText(
      'npx skills add https://github.com/dyson-yamashita/pufu-lens-stock/tree/main/skills --skill support-pufu -g',
    );
    await expect(browser.locator('#skills a')).toHaveAttribute(
      'href',
      'https://github.com/dyson-yamashita/pufu-lens-stock/tree/main/skills',
    );
    expect(
      await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await app.screenshot('skills-manual-light');
    await browser.emulateMedia({ colorScheme: 'dark' });
    await app.screenshot('skills-manual-dark');
    await browser.emulateMedia({ colorScheme: 'light' });
  } finally {
    await new Promise<void>((resolve, reject) => {
      callbackServer.close((error) => (error ? reject(error) : resolve()));
    });
    await fixture.request(`/projects/${second.id}`, 'DELETE');
  }
});
