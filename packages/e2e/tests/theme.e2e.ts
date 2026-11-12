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
  const logo = screen.getByRole('img', 'Pufu Lens', { exact: true });
  const toggle = screen.getByRole('switch', 'ダークモード', { exact: true });
  const checkLogo = async (theme: 'light' | 'dark') => {
    await expect(logo).toBeVisible();
    expect(
      await browser.evaluate(async (theme) => {
        const image = document.querySelector<HTMLImageElement>('.login-page .brand-logo')!;
        const mark = document.querySelector<HTMLImageElement>('.login-page .brand-mark')!;
        await Promise.all([image.decode(), mark.decode()]);
        const bounds = image.getBoundingClientRect();
        const markBounds = mark.getBoundingClientRect();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        // Pの上部を読み、OS設定とは独立した手動テーマでも文字が明暗反転することを確認する。
        const [red, green, blue, alpha] = context.getImageData(100, 30, 1, 1).data;
        const brightness = (red + green + blue) / 3;
        return (
          alpha === 255 &&
          (theme === 'dark' ? brightness > 200 : brightness < 100) &&
          markBounds.width >= 32 &&
          markBounds.left >= 0 &&
          markBounds.right < bounds.left &&
          bounds.width > bounds.height * 3 &&
          bounds.left >= 0 &&
          bounds.right <= window.innerWidth &&
          document.documentElement.scrollWidth <= window.innerWidth
        );
      }, theme),
    ).toBe(true);
  };
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await checkLogo('dark');
  await toggle.click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await checkLogo('light');
  await app.screenshot('home-theme-light');
  await browser.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await checkLogo('dark');
  await app.screenshot('home-theme-dark');
  await browser.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await browser.emulateMedia({ colorScheme: 'light' });
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await checkLogo('dark');
  await browser.locator('#site-language').selectOption({ value: 'en' });
  await expect(html).toHaveAttribute('lang', 'en');
  const englishToggle = screen.getByRole('switch', 'Dark mode', { exact: true });
  await expect(englishToggle).toHaveAttribute('aria-checked', 'true');
  await checkLogo('dark');
  await englishToggle.click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await browser.keyboard.press('Space');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(englishToggle).toHaveAttribute('aria-checked', 'true');
  await browser.keyboard.press('Enter');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(englishToggle).toHaveAttribute('aria-checked', 'false');
});
