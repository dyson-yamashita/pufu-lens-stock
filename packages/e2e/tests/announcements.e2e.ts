import { expect } from 'e2e';
import { test } from '../src/fixtures.ts';

test('NEWS-001 お知らせの閲覧と通知設定の入口を確認する', async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  for (const scope of ['', `/${fixture.projectId}`]) {
    for (const view of ['stocks', 'questions', 'pufus', 'memory']) {
      const hash = view === 'stocks' ? (scope ? `project${scope}` : '') : `${view}${scope}`;
      await app.open(`/#${hash}`);
      const footer = browser.locator('.library-footer');
      await expect(footer).toHaveCount(1);
      for (const href of ['/privacy', '/terms', '/#announcements']) {
        const link = browser.locator(`.library-footer a[href="${href}"]`);
        await expect(link).toBeVisible();
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noreferrer');
      }
      for (const theme of ['light', 'dark'] as const) {
        await browser.emulateMedia({ colorScheme: theme });
        expect(
          await browser.evaluate(() => {
            const rect = document.querySelector('.library-footer')!.getBoundingClientRect();
            return rect.left >= 0 && rect.right <= window.innerWidth;
          }),
        ).toBe(true);
      }
    }
  }
  await app.open('/');
  // The authenticated app loads asynchronously; inspect its menu after it mounts.
  await expect(browser.locator('.app-shell')).toBeVisible();
  const menu = screen.getByRole('button', 'メニューを開く', { exact: true });
  if (await menu.isVisible()) await menu.click();
  await screen.getByRole('button', 'お知らせ', { exact: true }).click();
  await expect(screen.getByRole('heading', 'お知らせ', { exact: true })).toBeVisible();
  await expect(screen.getByRole('switch', '通知設定', { exact: true })).toHaveCount(0);
  await screen.getByRole('link', 'お知らせページを追加しました', { exact: true }).click();
  await expect(
    screen.getByRole('heading', 'お知らせページを追加しました', { exact: true }),
  ).toBeVisible();
  await browser.reload();
  await expect(
    screen.getByRole('heading', 'お知らせページを追加しました', { exact: true }),
  ).toBeVisible();
  await screen.getByRole('link', 'お知らせ一覧へ', { exact: true }).click();
  await expect(
    screen.getByRole('link', 'お知らせページを追加しました', { exact: true }),
  ).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await browser.emulateMedia({ colorScheme: theme });
    await app.screenshot(`announcements-${theme}`);
    expect(
      await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await app.open('/#profile');
  await expect(screen.getByRole('heading', '通知設定', { exact: true })).toBeVisible();
  await expect(screen.getByRole('switch', '通知設定', { exact: true })).toBeDisabled();
  expect(
    await browser.evaluate(() =>
      document.querySelector('.push-settings-help')!.hasAttribute('open'),
    ),
  ).toBe(false);
  await expect(
    browser.locator('.profile-card + .usage-card + .appearance-settings + .push-settings'),
  ).toBeVisible();
  await app.open('/manual#announcements');
  await expect(screen.getByRole('heading', 'お知らせ', { exact: true })).toBeVisible();
});
