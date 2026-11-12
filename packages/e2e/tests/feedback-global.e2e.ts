import { expect } from 'e2e';
import { test } from '../src/fixtures.ts';

test('FEEDBACK-006 プ譜以外でも操作失敗の反復を案内し、処理中は抑止する', async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  await app.open(`/#project/${fixture.projectId}`);
  await expect(browser.locator('.pufi-feedback')).toHaveCount(0);
  await screen.getByRole('button', '記事をストック', { exact: true }).click();
  await screen.getByRole('tab', 'テキスト', { exact: true }).click();
  await screen.getByLabel('本文', { exact: true }).fill('E2E 保存失敗を確認する本文');
  await browser.route(`${fixture.url}/api/v1/stocks`, async (route) => {
    if (route.request.method !== 'POST') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'E2E 保存に失敗しました' }),
    });
  });
  await screen.getByRole('button', 'ストックする', { exact: true }).click();
  await expect(screen.getByRole('alert')).toContainText('E2E 保存に失敗しました');
  await expect(browser.locator('.pufi-feedback')).toHaveCount(0);
  await screen.getByRole('button', 'ストックする', { exact: true }).click();
  await expect(browser.locator('.pufi-prompt')).toContainText('操作でお困りですか？');
  expect(
    await browser.evaluate(() => Boolean(document.querySelector('dialog[open] .pufi-feedback'))),
  ).toBe(true);
  expect(
    await browser.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.querySelector('dialog[open]')!).paddingBottom),
    ),
  ).toBeGreaterThanOrEqual(110);
  await screen.getByRole('button', '大丈夫です', { exact: true }).click();
  await expect(browser.locator('.pufi-feedback')).toHaveCount(0);
  await screen.getByRole('button', '閉じる', { exact: true }).click();
});

test('FEEDBACK-007 無反応のコントロールを全画面共通で検知する', async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  await app.open(`/#project/${fixture.projectId}`);
  // A local fixture creates a truly inert button; no production service is broken.
  await browser.evaluate(() => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'E2E 無反応の操作';
    document.querySelector('main')!.prepend(button);
    return null;
  });
  for (let i = 0; i < 4; i++)
    await screen.getByRole('button', 'E2E 無反応の操作', { exact: true }).click();
  await expect(browser.locator('.pufi-prompt')).toContainText('操作でお困りですか？');
  await screen.getByRole('button', '大丈夫です', { exact: true }).click();
});

test('FEEDBACK-008 ネイティブ入力エラーの反復を検知し入力欄から離れてから案内する', async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  await app.open(`/#project/${fixture.projectId}`);
  await screen.getByRole('button', '記事をストック', { exact: true }).click();
  for (let i = 0; i < 3; i++)
    await screen.getByRole('button', 'ストックする', { exact: true }).click();
  await expect(browser.locator('.pufi-feedback')).toHaveCount(0);
  await browser.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    return null;
  });
  await expect(browser.locator('.pufi-prompt')).toContainText('操作でお困りですか？');
  await screen.getByRole('button', '大丈夫です', { exact: true }).click();
  await screen.getByRole('button', '閉じる', { exact: true }).click();
});
