import { expect } from 'e2e';
import { test } from '@e2e-dev/web';

test('FAQ-001 未ログインでFAQへ移動し検索・クリア・日英表示を確認する', async ({
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
  await app.open('/');
  const headerLink = browser.locator('.login-header-links a[href="/manual"] + a');
  await expect(headerLink).toHaveText('FAQ');
  await expect(headerLink).toHaveAttribute('href', '/faq');
  await expect(browser.locator('.login-footer a[href="/faq"] + a')).toHaveAttribute(
    'href',
    '/#announcements',
  );
  for (const theme of ['light', 'dark'] as const) {
    await browser.emulateMedia({ colorScheme: theme });
    expect(
      await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await headerLink.click();
  await expect(screen.getByRole('heading', 'よくある質問（FAQ）', { exact: true })).toBeVisible();
  await expect(browser.locator('.faq-item')).toHaveCount(28);
  await expect(browser.locator('main section')).toHaveCount(6);
  expect(
    await browser.evaluate(
      () => document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
    ),
  ).toBe('PufuLensの機能・料金・使い方・個人情報の取り扱いなど、よくある質問をまとめました。');
  await browser.locator('#faq-free summary').click();
  await expect(browser.locator('#faq-free .faq-answer')).toContainText(
    'PufuLensの機能は無料で利用できます。',
  );
  const input = browser.locator('#faq-search');
  await input.fill('ｍｃｐ　無料');
  await expect(browser.locator('.faq-item')).toHaveCount(1);
  await expect(browser.locator('#faq-free .faq-answer')).toBeVisible();
  await expect(screen.getByRole('status')).toHaveText('1件の質問');
  await app.screenshot('faq-ja-search');
  await input.fill('Safari');
  await expect(browser.locator('#faq-devices .faq-answer')).toBeVisible();
  await expect(browser.locator('.faq-item')).toHaveCount(1);
  await input.fill('存在しないキーワード');
  await expect(browser.locator('.faq-item')).toHaveCount(0);
  await expect(screen.getByRole('status')).toHaveText('0件の質問');
  await expect(browser.locator('.manual-note')).toContainText('一致する質問が見つかりませんでした');
  await screen.getByRole('button', '検索をクリア', { exact: true }).click();
  await expect(browser.locator('.faq-item')).toHaveCount(28);
  expect(await browser.evaluate(() => document.activeElement?.id ?? null)).toBe('faq-search');
  await browser.locator('#faq-contact summary').click();
  await expect(browser.locator('#faq-contact a')).toHaveAttribute(
    'href',
    'mailto:pufu-lens@haluworks.com',
  );
  await browser.locator('#faq-policies summary').click();
  await expect(browser.locator('#faq-policies a[href="/terms"]')).toBeVisible();
  await expect(browser.locator('#faq-policies a[href="/privacy"]')).toBeVisible();
  await browser.reload();
  await expect(browser.locator('.faq-item')).toHaveCount(28);
  for (const theme of ['light', 'dark'] as const) {
    await browser.emulateMedia({ colorScheme: theme });
    await browser.evaluate(() => {
      window.scrollTo(0, 0);
      return true;
    });
    await app.screenshot(`faq-ja-${theme}`);
    expect(
      await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await browser.locator('.page-header a[lang="en"]').click();
  await expect(
    screen.getByRole('heading', 'Frequently asked questions (FAQ)', { exact: true }),
  ).toBeVisible();
  await expect(browser.locator('html')).toHaveAttribute('lang', 'en');
  await expect(browser.locator('.faq-item')).toHaveCount(28);
  await browser.locator('#faq-search').fill('ＭＣＰ ＦＲＥＥ');
  await expect(browser.locator('.faq-item')).toHaveCount(1);
  await expect(browser.locator('#faq-free .faq-answer')).toBeVisible();
  await screen.getByRole('button', 'Clear search', { exact: true }).click();
  await browser.locator('#faq-manual summary').click();
  await expect(browser.locator('#faq-manual a')).toHaveAttribute('href', '/en/manual');
  await browser.locator('#faq-policies summary').click();
  await expect(browser.locator('#faq-policies a[href="/en/terms"]')).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await browser.emulateMedia({ colorScheme: theme });
    await browser.evaluate(() => {
      window.scrollTo(0, 0);
      return true;
    });
    await app.screenshot(`faq-en-${theme}`);
    expect(
      await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await app.open('/en');
  await expect(browser.locator('.login-header-links a[href="/en/manual"] + a')).toHaveAttribute(
    'href',
    '/en/faq',
  );
  await browser.locator('.login-footer a[href="/en/faq"]').click();
  await expect(
    screen.getByRole('heading', 'Frequently asked questions (FAQ)', { exact: true }),
  ).toBeVisible();
});
