import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

// Use a separate fixture because first-registration language must be verified
// before the ordinary fixture completes onboarding. All data belongs to the
// runner's disposable loopback D1/R2/KV; no real identities or services are used.
test('LANG-001 初回言語選択と再読込・別ブラウザー状態・設定変更を保持する', async ({
  app,
  screen,
  browser,
}) => {
  const address = new URL(app.baseUrl ?? 'about:blank');
  if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || !address.port)
    throw new Error('ローカル専用です。');
  const url = address.origin;
  await browser.route('**/*', async (route) => {
    if (new URL(route.request.url).origin === url) await route.continue();
    else await route.abort();
  });
  // The demo identity can be shared by preceding scenarios. Delete only that
  // dummy account through the same authorized API to exercise first sign-in.
  const prepared = await fetch(`${url}/api/auth/demo`, {
    method: 'POST',
    headers: { Origin: url },
  });
  expect(prepared.ok).toBe(true);
  const setupCookie = prepared.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  const removed = await fetch(`${url}/api/v1/me`, {
    method: 'DELETE',
    headers: { Origin: url, Cookie: setupCookie, 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(removed.ok).toBe(true);

  await app.clearState();
  await app.open('/');
  await expect(browser.locator('html')).toHaveAttribute('lang', 'ja');
  await browser.locator('#site-language').selectOption({ value: 'en' });
  await expect(browser.locator('html')).toHaveAttribute('lang', 'en');
  await browser.locator('.demo-login').click();
  await expect(browser.locator('#onboarding-language')).toHaveValue('en');
  await expect(browser.locator('html')).toHaveAttribute('lang', 'en');
  await browser.locator('#onboarding-name').fill('Language test user');
  await browser.locator('#onboarding-terms').check();
  await browser.locator('#onboarding-privacy').check();
  await screen.getByRole('button', 'OK').click();
  await expect(screen.getByRole('heading', 'All stocks')).toBeVisible();
  const cookies = await browser.cookies();
  const cookie = cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
  const identity = async () => {
    const response = await fetch(`${url}/api/v1/me`, { headers: { Cookie: cookie } });
    expect(response.ok).toBe(true);
    return response.json() as Promise<{ user: { name: string; language: string } }>;
  };
  try {
    expect((await identity()).user).toMatchObject({ name: 'Language test user', language: 'en' });
    // Same account, Japanese browser, no local preference: server value wins.
    await app.clearState();
    await browser.setCookies(cookies);
    await app.open('/#profile');
    // clearState reopens the anonymous base page; a hash-only open reuses it.
    // Reload so App reads the restored session in a fresh document.
    await browser.reload();
    await expect(browser.locator('#profile-language')).toHaveValue('en');
    await expect(screen.getByRole('heading', 'Profile', { exact: true })).toBeVisible();
    await expect(browser.locator('html')).toHaveAttribute('lang', 'en');
    const request = async (path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(`${url}/api/v1${path}`, {
        method,
        headers: { Origin: url, Cookie: cookie, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      expect(response.ok).toBe(true);
      return response.json() as Promise<Record<string, unknown>>;
    };
    const project = await request('/projects', 'POST', {
      name: 'Language project',
      description: '',
    });
    const score = JSON.parse(
      await readFile(new URL('../../../tests/fixtures/pufu-sparse.json', import.meta.url), 'utf8'),
    );
    score.gainingGoal.text = 'Language test score';
    const created = (await request('/pufus', 'POST', {
      project_id: project.id,
      request_id: randomUUID(),
      score,
    })) as { pufu: { id: string } };
    await app.open(`/#pufu/${created.pufu.id}`);
    await expect(browser.locator('.pufu-image-open svg')).toContainText('Measures');
    await browser.locator('.pufu-image-actions button').click();
    await expect(browser.locator('.pufu-editor-root')).toContainText('Win condition');
    await expect(browser.locator('.pufu-editor-root')).not.toContainText('score.WinCondition');
    await screen.getByRole('button', 'Close', { exact: true }).click();
    const saved = (await request(`/pufus/${created.pufu.id}`)) as {
      pufu: { phases: { score: unknown }[] };
    };
    expect(saved.pufu.phases[0].score).toEqual(score);
    await app.open('/#profile');
    await browser.locator('#profile-language').selectOption({ value: 'ja' });
    await browser.locator('.profile-card form button[type="submit"]').click();
    await expect(browser.locator('html')).toHaveAttribute('lang', 'ja');
    await browser.reload();
    await expect(browser.locator('#profile-language')).toHaveValue('ja');
    await expect(screen.getByRole('heading', 'プロフィール', { exact: true })).toBeVisible();
    expect((await identity()).user).toMatchObject({ name: 'Language test user', language: 'ja' });
  } finally {
    const cleaned = await fetch(`${url}/api/v1/me`, {
      method: 'DELETE',
      headers: { Origin: url, Cookie: cookie, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(cleaned.ok).toBe(true);
  }
});
