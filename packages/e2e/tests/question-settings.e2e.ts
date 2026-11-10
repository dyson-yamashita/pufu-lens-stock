import { expect } from 'e2e';
import { test } from '../src/fixtures.ts';

test('QUESTION-001 問いのメモと関連ストックを変更し再読込後も本文と設定を保持する', async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  const stocks = [];
  for (const title of ['E2E元の記事', 'E2E追加する記事', 'E2E選び直す記事']) {
    stocks.push(
      await fixture.request('/stocks', 'POST', {
        project_id: fixture.projectId,
        type: 'text',
        title,
        text: `${title}の本文です。`,
        skip_summary: true,
      }),
    );
  }
  const text = 'この記事から次に何を確かめたいか？';
  const { question } = (await fixture.request('/questions', 'POST', {
    project_id: fixture.projectId,
    text,
    stock_ids: [stocks[0].id],
  })) as { question: { id: string } };
  await app.open(`/#question/${question.id}`);
  await expect(screen.getByRole('heading', text, { exact: true })).toBeVisible();
  await screen.getByRole('tab', 'メモ・保存先', { exact: true }).click();
  const note = '最初に確かめる理由\n次に試すことを残します。';
  await screen.getByLabel('メモ', { exact: true }).fill(note);
  await screen.getByRole('checkbox', 'E2E追加する記事', { exact: true }).check();
  await screen.getByRole('button', '変更を保存', { exact: true }).click();
  await expect(
    screen.getByRole('status').filter({ hasText: 'メモ・保存先・関連を保存しました。' }),
  ).toBeVisible();
  await browser.reload();
  await expect(screen.getByRole('heading', text, { exact: true })).toBeVisible();
  await expect(browser.locator('.question-detail-source')).toHaveCount(2);
  await screen.getByRole('tab', 'メモ・保存先', { exact: true }).click();
  await expect(screen.getByLabel('メモ', { exact: true })).toHaveValue(note);
  await expect(screen.getByRole('checkbox', 'E2E元の記事', { exact: true })).toBeChecked();
  await expect(screen.getByRole('checkbox', 'E2E追加する記事', { exact: true })).toBeChecked();
  await screen.getByRole('checkbox', 'E2E元の記事', { exact: true }).uncheck();
  await screen.getByRole('checkbox', 'E2E選び直す記事', { exact: true }).check();
  await screen.getByRole('button', '変更を保存', { exact: true }).click();
  await expect(
    screen.getByRole('status').filter({ hasText: 'メモ・保存先・関連を保存しました。' }),
  ).toBeVisible();
  await browser.reload();
  await expect(screen.getByRole('heading', text, { exact: true })).toBeVisible();
  await expect(browser.locator('.question-detail-source')).toHaveCount(2);
  await expect(browser.locator('.question-detail-card')).not.toContainText('E2E元の記事');
  await screen.getByRole('tab', 'メモ・保存先', { exact: true }).click();
  await expect(screen.getByLabel('メモ', { exact: true })).toHaveValue(note);
  await expect(screen.getByRole('checkbox', 'E2E元の記事', { exact: true })).not.toBeChecked();
  await expect(screen.getByRole('checkbox', 'E2E追加する記事', { exact: true })).toBeChecked();
  await expect(screen.getByRole('checkbox', 'E2E選び直す記事', { exact: true })).toBeChecked();
  const saved = (await fixture.request(`/questions/${question.id}`)) as {
    question: { text: string; note: string; stock_ids: string[]; project_id: string };
  };
  expect(saved.question).toMatchObject({ text, note, project_id: fixture.projectId });
  expect(saved.question.stock_ids.slice().sort()).toEqual([stocks[1].id, stocks[2].id].sort());
});
