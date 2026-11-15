import { expect } from 'e2e';
import { test } from '../src/fixtures.ts';
import { checkPufiCompose } from '../src/pufi-layout.ts';

test('FEEDBACK-012 日英マニュアルのプフィで入力幅と送信ボタンの配置を保つ', async ({
  app,
  browser,
}) => {
  for (const path of ['/manual', '/en/manual']) {
    await app.open(path);
    await expect(browser.locator('.pufi-avatar')).toBeVisible();
    // Input feedback and manual search share the composer CSS in separate components.
    for (const category of [2, 1]) {
      await browser.locator('.pufi-avatar').click();
      await browser.locator('.pufi-chip').nth(category).click();
      await expect(browser.locator('.pufi-compose textarea')).toBeVisible();
      await checkPufiCompose(browser);
      await app.screenshot(`pufi-compose-${path === '/manual' ? 'ja' : 'en'}-${category}`);
      await browser.locator('.pufi-avatar').click();
    }
  }
});
