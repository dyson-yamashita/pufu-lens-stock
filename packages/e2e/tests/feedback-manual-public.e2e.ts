import { expect } from 'e2e';
import { test } from '@e2e-dev/web';

test('FEEDBACK-009 未ログインのマニュアルには表示しない', async ({ app, screen, browser }) => {
  const url = new URL(app.baseUrl!).origin;
  await browser.route('**/*', async (route) => {
    if (new URL(route.request.url).origin === url) await route.continue();
    else await route.abort();
  });
  await app.open('/manual');
  await expect(screen.getByRole('heading', 'ユーザーマニュアル', { exact: true })).toBeVisible();
  expect(await browser.evaluate(async () => (await fetch('/api/v1/me')).status)).toBe(401);
  await expect(browser.locator('.pufi-feedback')).toHaveCount(0);
});
