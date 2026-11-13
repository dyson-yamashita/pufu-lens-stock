import { expect } from 'e2e';
import { test } from '../src/fixtures.ts';

test('NEWS-001 お知らせの閲覧と通知設定の入口を確認する', async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  void fixture;
  await app.open('/#announcements');
  await expect(screen.getByRole('heading', 'お知らせ', { exact: true })).toBeVisible();
  await expect(screen.getByRole('heading', 'お知らせのPush通知', { exact: true })).toBeVisible();
  await expect(screen.getByRole('button', '通知を有効にする', { exact: true })).toHaveCount(0);
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
  await expect(screen.getByRole('heading', 'お知らせのPush通知', { exact: true })).toBeVisible();
  await app.open('/manual#announcements');
  await expect(screen.getByRole('heading', 'お知らせ', { exact: true })).toBeVisible();
});
