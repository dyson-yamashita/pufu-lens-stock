import { expect } from 'e2e';
import { test } from '@e2e-dev/web';

test('THEME-001 トップの太陽・月でテーマを選び、再読込と言語変更後も保持する', async ({
  app,
  browser,
}) => {
  const address = new URL(app.baseUrl ?? 'about:blank');
  if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || !address.port)
    throw new Error('ローカル専用です。');
  await browser.route('**/*', async (route) => {
    if (new URL(route.request.url).origin === address.origin) await route.continue();
    else await route.abort();
  });
  await app.clearState();
  await browser.emulateMedia({ colorScheme: 'dark' });
  await app.open('/');
  const html = browser.locator('html');
  const toggle = browser.locator('.theme-toggle');
  const light = toggle.getByRole('button', 'ライト', { exact: true });
  const dark = toggle.getByRole('button', 'ダーク', { exact: true });
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(dark).toHaveAttribute('aria-pressed', 'true');
  await expect(light).toHaveAttribute('aria-pressed', 'false');
  await light.click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(light).toHaveAttribute('aria-pressed', 'true');
  await expect(dark).toHaveAttribute('aria-pressed', 'false');
  await app.screenshot('home-theme-light');
  await browser.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(light).toHaveAttribute('aria-pressed', 'true');
  await dark.click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(dark).toHaveAttribute('aria-pressed', 'true');
  await expect(light).toHaveAttribute('aria-pressed', 'false');
  await app.screenshot('home-theme-dark');
  await browser.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await browser.emulateMedia({ colorScheme: 'light' });
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await browser.locator('#site-language').selectOption({ value: 'en' });
  await expect(html).toHaveAttribute('lang', 'en');
  await expect(toggle.getByRole('button', 'Dark', { exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await toggle.getByRole('button', 'Light', { exact: true }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
});
