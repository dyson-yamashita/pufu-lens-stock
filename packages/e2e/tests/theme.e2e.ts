import { expect } from 'e2e';
import { test } from '@e2e-dev/web';

test('THEME-001 トップのスイッチでテーマを選び、再読込と言語変更後も保持する', async ({
  app,
  browser,
  screen,
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
  const toggle = screen.getByRole('switch', 'ダークモード', { exact: true });
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await app.screenshot('home-theme-light');
  await browser.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await app.screenshot('home-theme-dark');
  await browser.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await browser.emulateMedia({ colorScheme: 'light' });
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await browser.locator('#site-language').selectOption({ value: 'en' });
  await expect(html).toHaveAttribute('lang', 'en');
  const englishToggle = screen.getByRole('switch', 'Dark mode', { exact: true });
  await expect(englishToggle).toHaveAttribute('aria-checked', 'true');
  await englishToggle.click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await browser.keyboard.press('Space');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(englishToggle).toHaveAttribute('aria-checked', 'true');
  await browser.keyboard.press('Enter');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(englishToggle).toHaveAttribute('aria-checked', 'false');
});
