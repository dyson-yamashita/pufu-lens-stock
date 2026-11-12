import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect } from 'e2e';
import { test, type Fixture } from '../src/fixtures.ts';
import type { ThemePreference } from '../../../src/theme';

async function createPufu(fixture: Fixture) {
  const score = JSON.parse(
    await readFile(new URL('../../../tests/fixtures/pufu-sparse.json', import.meta.url), 'utf8'),
  );
  const { pufu } = (await fixture.request('/pufus', 'POST', {
    project_id: fixture.projectId,
    request_id: randomUUID(),
    score,
  })) as { pufu: { id: string } };
  return pufu;
}

test('FEEDBACK-004 常設の案内から会話し、進捗のない開閉で迷いを確認する', async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  const pufu = await createPufu(fixture);
  await app.open(`/#pufu/${pufu.id}`);
  const invitation = screen.getByRole('button', '何かお困りですか？', { exact: true });
  await expect(invitation).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await browser.evaluate(async (theme) => {
      window.pufuTheme.setPreference(theme as ThemePreference);
      void document.documentElement.offsetWidth;
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
          .map((animation) => animation.finished.catch(() => undefined)),
      );
      return null;
    }, theme);
    expect(
      await browser.evaluate(() => {
        const text = document.querySelector('.pufi-invitation')!.getBoundingClientRect();
        const icon = document.querySelector('.pufi-avatar')!.getBoundingClientRect();
        return (
          text.left >= 0 &&
          text.right < icon.left &&
          icon.right <= innerWidth &&
          icon.bottom <= innerHeight
        );
      }),
    ).toBe(true);
    await app.screenshot(`pufi-invitation-${theme}`);
  }
  await invitation.click();
  await expect(browser.locator('.pufi-thread')).toContainText('お困りのことを教えてください。');
  await expect(invitation).toHaveCount(0);
  await screen.getByRole('button', 'プフィの設定').click();
  await expect(screen.getByLabel('声かけを受け取る')).not.toBeChecked();
  await screen.getByLabel('声かけを受け取る').check();
  await screen.getByRole('button', 'プフィとの会話を閉じる').click();
  const abandonDownload = async () => {
    await screen.getByRole('button', 'ダウンロード', { exact: true }).click();
    await screen.getByRole('button', '閉じる', { exact: true }).click();
  };
  await abandonDownload();
  await abandonDownload();
  await expect(browser.locator('.pufi-prompt')).toHaveCount(0);
  // A real successful save resets the earlier exploration history.
  await screen.getByRole('button', '編集する', { exact: true }).click();
  expect(
    await browser.evaluate(() =>
      parseFloat(getComputedStyle(document.querySelector('.dialog.pufu-modal')!).paddingBottom),
    ),
  ).toBeGreaterThanOrEqual(110);
  await screen.getByRole('button', '保存', { exact: true }).click();
  await expect(browser.locator('.toast')).toContainText('プ譜を保存しました。');
  await screen.getByRole('button', '閉じる', { exact: true }).click();
  await abandonDownload();
  await abandonDownload();
  await expect(browser.locator('.pufi-prompt')).toHaveCount(0);
  await abandonDownload();
  await expect(browser.locator('.pufi-prompt')).toContainText('操作でお困りですか？');
  // This case checks guidance and an unsent reply; the DB contract is exercised by Vitest.
  // Keep end-to-end submissions within the real per-account daily limit.
  const posts: string[] = [];
  await browser.route(`${fixture.url}/api/v1/feedback`, async (route) => {
    posts.push(route.request.postData ?? '');
    await route.continue();
  });
  await screen.getByRole('button', 'はい', { exact: true }).click();
  await screen.getByRole('button', '操作に迷いました', { exact: true }).click();
  await screen.getByLabel('プフィへの返答').fill('ダウンロードの形式をどれにするか迷いました。');
  await screen.getByRole('button', 'プフィとの会話を閉じる', { exact: true }).click();
  expect(posts).toHaveLength(0);
  await expect(invitation).toBeVisible();
  await browser.locator('.delete-action summary').click();
  await expect(screen.getByRole('button', 'プ譜を削除', { exact: true })).toBeVisible();
  await browser.locator('.delete-action summary').click();
});

test('FEEDBACK-005 エラーがなくても局面を繰り返し探す操作で案内する', async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  const pufu = await createPufu(fixture);
  await app.open(`/#pufu/${pufu.id}`);
  await screen.getByRole('button', '局面を追加', { exact: true }).click();
  await expect(browser.locator('.pufu-phase-number')).toHaveText('第2局面');
  await screen.getByRole('button', '何かお困りですか？', { exact: true }).click();
  await screen.getByRole('button', 'プフィの設定').click();
  await screen.getByLabel('声かけを受け取る').check();
  await screen.getByRole('button', 'プフィとの会話を閉じる').click();
  for (let i = 0; i < 3; i++) {
    await screen.getByRole('button', '前の局面へ', { exact: true }).click();
    await screen.getByRole('button', '次の局面へ', { exact: true }).click();
    if (i < 2) await expect(browser.locator('.pufi-prompt')).toHaveCount(0);
  }
  await expect(browser.locator('.pufi-prompt')).toContainText('操作でお困りですか？');
  await screen.getByRole('button', '大丈夫です', { exact: true }).click();
  await expect(screen.getByRole('button', '何かお困りですか？', { exact: true })).toBeVisible();
});
