import { test as base } from '@e2e-dev/web';
import { expect } from 'e2e';
import { randomUUID } from 'node:crypto';

export type Fixture = {
  url: string;
  projectId: string;
  projectName: string;
  cookie: string;
  request: (path: string, method?: string, body?: unknown) => Promise<Record<string, unknown>>;
};
export const test = base.extend<{ fixture: Fixture }>({
  fixture: async ({ app, screen, browser }, use) => {
    const address = new URL(app.baseUrl ?? 'about:blank');
    if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || !address.port)
      throw new Error('ローカル専用です。');
    const url = address.origin;
    await browser.route('**/*', async (route) => {
      if (new URL(route.request.url).origin === url) await route.continue();
      else await route.abort();
    });
    await app.open('/');
    await screen.getByRole('button', 'ローカルデモを開く').click();
    await expect(browser.locator('.onboarding-page, .app-shell')).toBeVisible();
    if (await screen.getByRole('heading', 'Pufu Lensへようこそ').isVisible()) {
      await screen.getByLabel('ニックネーム（表示名）必須').fill('E2E利用者');
      await browser.locator('#onboarding-terms').check();
      await browser.locator('#onboarding-privacy').check();
      await screen.getByRole('button', 'OK').click();
    }
    await expect(screen.getByRole('heading', 'すべてのストック')).toBeVisible();
    const cookie = (await browser.cookies())
      .map(({ name, value }) => `${name}=${value}`)
      .join('; ');
    const request = async (path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(`${url}/api/v1${path}`, {
        method,
        headers: { Cookie: cookie, Origin: url, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok)
        throw new Error(`${method} ${path}: ${response.status} ${data.error ?? ''}`);
      return data;
    };
    const projectName = 'E2E検証プロジェクト';
    const { id } = await request('/projects', 'POST', {
      name: projectName,
      description: 'E2E専用の使い捨てデータ',
    });
    const projectId = String(id);
    await use({ url, projectId, projectName, cookie, request });
    await request(`/projects/${projectId}`, 'DELETE');
  },
});
export const requestId = () => randomUUID();
