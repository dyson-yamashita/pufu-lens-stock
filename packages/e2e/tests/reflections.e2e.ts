import { expect } from 'e2e';
import { test } from '../src/fixtures.ts';

test('REFLECTION-001 期間から問いを作り、きっかけと回答を再読込後も確認する', async ({
  app,
  browser,
  screen,
  fixture,
}) => {
  const title = '説明の変化を観察した記録';
  const { id: stockId } = await fixture.request('/stocks', 'POST', {
    project_id: fixture.projectId,
    type: 'text',
    title,
    text: '操作を観察して、説明文を短くした。',
  });
  await app.open(`/#questions/${fixture.projectId}`);
  await expect(screen.getByRole('heading', '振り返り', { exact: true })).toBeVisible();
  await browser.locator('.reflection-period summary').click();
  await expect(screen.getByRole('combobox', '期間', { exact: true })).toHaveValue('7');
  await screen.getByRole('button', '振り返りの問いを作る', { exact: true }).click();

  const card = browser.locator('.reflection-card');
  const source = card.getByRole('button', new RegExp(title));
  await expect(source).toBeVisible({ timeout: 30000 });
  await expect(browser.locator('.reflection-card .question-text')).toContainText(title);
  await source.click();
  await expect(screen.getByRole('heading', title, { exact: true })).toBeVisible();
  await browser.back();
  await expect(source).toBeVisible();

  const answer = '説明を短くする前に、最初の操作で迷う場所を見ておく。';
  await card.getByLabel('気づいたこと', { exact: true }).fill(answer);
  await card.getByRole('button', '振り返りとして保存', { exact: true }).click();
  await expect(card.getByText(answer, { exact: true })).toBeVisible();
  await browser.reload();
  await expect(card.getByText(answer, { exact: true })).toBeVisible();
  const result = await fixture.request(`/reflections?project_id=${fixture.projectId}`);
  const [saved] = result.reflections as { answer: string; stocks: { id: string }[] }[];
  expect(saved.answer).toBe(answer);
  expect(saved.stocks.map(({ id }) => id)).toEqual([stockId]);
});
