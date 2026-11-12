import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect } from 'e2e';
import { test } from '../src/fixtures.ts';

test('FEEDBACK-001 プフィの設定・任意回答・追加質問・編集画面内の表示', async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  const score = JSON.parse(
    await readFile(new URL('../../../tests/fixtures/pufu-sparse.json', import.meta.url), 'utf8'),
  );
  const { pufu } = (await fixture.request('/pufus', 'POST', {
    project_id: fixture.projectId,
    request_id: randomUUID(),
    score,
  })) as { pufu: { id: string } };
  await app.open(`/#pufu/${pufu.id}`);
  const open = screen.getByRole('button', 'プフィに伝える・設定');
  await open.click();
  const enable = screen.getByLabel('操作で困ったときの自動案内を許可する');
  await expect(enable).not.toBeChecked();
  await enable.check();
  await screen.getByRole('button', '伝える', { exact: true }).click();
  await expect(screen.getByRole('button', '送信する', { exact: true })).toBeDisabled();
  await screen.getByLabel('回答の保存・AI判定と、改善内容のGitHub掲載に同意する').check();
  await screen.getByRole('button', '送信する', { exact: true }).click();
  await expect(
    screen.getByRole('status').filter({ hasText: '教えてくれてありがとう' }),
  ).toBeVisible();
  await screen.getByRole('button', 'フィードバックを閉じる').click();
  await browser.reload();
  await screen.getByRole('button', '編集する', { exact: true }).click();
  await open.click();
  await expect(enable).toBeChecked();
  await enable.uncheck();
  await screen.getByRole('button', '伝える', { exact: true }).click();
  // Exercise the UI conversation without external AI or GitHub traffic.
  const requests: { request_id: string; round: number; answer?: string }[] = [];
  await browser.route(`${fixture.url}/api/v1/feedback`, async (route) => {
    const input = JSON.parse(route.request.postData ?? '{}');
    requests.push(input);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        received: true,
        round: input.round,
        follow_up: input.round === 0 ? 'どの操作で困りましたか？' : null,
      }),
    });
  });
  await screen.getByLabel('回答の保存・AI判定と、改善内容のGitHub掲載に同意する').check();
  await screen.getByRole('button', '送信する', { exact: true }).click();
  await expect(
    screen.getByRole('status').filter({ hasText: 'どの操作で困りましたか？' }),
  ).toBeVisible();
  await screen.getByLabel('追加の回答（任意）').fill('保存を押すと内容が戻りました');
  for (const theme of ['light', 'dark']) {
    await browser.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    expect(
      await browser.evaluate(() => {
        const panel = document.querySelector('.pufi-panel')!.getBoundingClientRect();
        return (
          panel.left >= 0 &&
          panel.right <= innerWidth &&
          panel.bottom <= innerHeight &&
          panel.top >= 0
        );
      }),
    ).toBe(true);
    await app.screenshot(`pufi-feedback-${theme}`);
  }
  await screen.getByRole('button', '送信する', { exact: true }).click();
  await expect(
    screen.getByRole('status').filter({ hasText: '教えてくれてありがとう' }),
  ).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0].request_id).toBe(requests[1].request_id);
  expect(requests[1]).toMatchObject({ round: 1, answer: '保存を押すと内容が戻りました' });
  await screen.getByRole('button', 'フィードバックを閉じる').click();
  await screen.getByRole('button', '閉じる', { exact: true }).click();
});
