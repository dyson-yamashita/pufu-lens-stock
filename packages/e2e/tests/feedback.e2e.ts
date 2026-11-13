import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect } from 'e2e';
import { test } from '../src/fixtures.ts';
import type { ThemePreference } from '../../../src/theme';

test('FEEDBACK-001 操作検知で声をかけ、プフィと短く話してDBへ保存する', async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  const reports: { page_path: string; viewport: string }[] = [];
  await browser.route(`${fixture.url}/api/v1/feedback`, async (route) => {
    reports.push(JSON.parse(route.request.postData ?? '{}'));
    await route.continue();
  });
  const score = JSON.parse(
    await readFile(new URL('../../../tests/fixtures/pufu-sparse.json', import.meta.url), 'utf8'),
  );
  const { pufu } = (await fixture.request('/pufus', 'POST', {
    project_id: fixture.projectId,
    request_id: randomUUID(),
    score,
  })) as { pufu: { id: string } };
  await app.open(`/?feedback_test=private#pufu/${pufu.id}`);
  await screen.getByRole('button', '局面を追加', { exact: true }).click();
  await expect(browser.locator('.pufu-phase-number')).toHaveText('第2局面');
  await expect(browser.locator('.pufi-feedback')).toHaveCount(0);
  await screen.getByRole('button', '編集する', { exact: true }).click();
  await browser.locator('.pufu-json-import-panel summary').click();
  await screen.getByLabel('JSONを貼り付け').fill('{');
  for (let i = 0; i < 3; i++) {
    await screen.getByRole('button', 'JSONテキストを読み込む').click();
    await expect(screen.getByRole('alert')).toContainText('JSONとして読み込めません');
  }
  await expect(browser.locator('.pufi-prompt')).toContainText('操作でお困りですか？');
  const capture = async (name: string) => {
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
          const p = document.querySelector('.pufi-panel')!.getBoundingClientRect();
          return p.left >= 0 && p.right <= innerWidth && p.top >= 0 && p.bottom <= innerHeight;
        }),
      ).toBe(true);
      await app.screenshot(`${name}-${theme}`);
    }
  };
  await capture('pufi-detected');
  await screen.getByRole('button', 'はい', { exact: true }).click();
  await screen.getByRole('button', '反応しません', { exact: true }).click();
  await screen.getByLabel('プフィへの返答').fill('保存しても、内容が戻ってしまいます。');
  await screen.getByRole('button', '送信', { exact: true }).click();
  await expect(browser.locator('.pufi-thread')).toContainText(
    'どのような動きを期待されていましたか？',
  );
  await expect(screen.getByRole('button', '回答を終了', { exact: true })).toBeVisible();
  await screen
    .getByLabel('プフィへの返答')
    .fill('保存した内容が、そのまま残ることを期待していました。');
  await expect(screen.getByRole('button', '送信して終了', { exact: true })).toBeVisible();
  await capture('pufi-conversation');
  await screen.getByRole('button', '送信', { exact: true }).click();
  await expect(browser.locator('.pufi-thread')).toContainText(
    '直前に行っていた操作を教えていただけますか？',
  );
  await screen.getByRole('button', '回答を終了').click();
  await expect(browser.locator('.pufi-thread')).toContainText(
    '保存についてご意見ありがとうございます。いただいたご意見はサービス改善に役立てます。',
  );
  expect(reports.length).toBeGreaterThan(0);
  const viewport = await browser.evaluate(() => `${innerWidth}x${innerHeight}`);
  expect(reports[0]).toMatchObject({ page_path: '/', viewport });
  await screen.getByRole('button', '会話を閉じる', { exact: true }).click();
  await screen.getByRole('button', '閉じる', { exact: true }).click();
  await browser.reload();
  await expect(screen.getByRole('button', '編集する', { exact: true })).toBeVisible();
  await expect(browser.locator('.pufi-feedback')).toHaveCount(0);
});
