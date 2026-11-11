import { expect } from 'e2e';
import { test, requestId } from '../src/fixtures.ts';

test('STOCK-002 URL記事の取得中・完了と取得失敗後の本文補完による再試行を確認する', async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  const key = requestId();
  const sourceUrl = `https://example.com/pufu-e2e/article?key=${key}`;
  await app.open(`/#project/${fixture.projectId}`);
  await screen.getByRole('button', '記事をストック', { exact: true }).click();
  await screen.getByLabel('投稿URL').fill(sourceUrl);
  await screen.getByRole('button', 'ストックする', { exact: true }).click();
  // The first reload may still be queued; allow the UI's 5s polling cycle to observe extraction.
  await expect(browser.locator('.article-card .status')).toHaveText('本文を取得中', {
    timeout: 15000,
  });
  const released = await fetch(`${fixture.url}/api/__e2e__/articles/${key}/release`, {
    method: 'POST',
  });
  expect(released.ok).toBe(true);
  await expect(browser.locator('.article-card .article-title')).toHaveText('E2EのURL記事', {
    timeout: 15000,
  });
  await expect(browser.locator('.article-card .status')).toHaveCount(0, { timeout: 15000 });
  await screen.getByRole('button', 'E2EのURL記事', { exact: true }).click();
  await expect(browser.locator('.detail-summary')).toContainText(
    '保存と要約を分離し、失敗後も同じストックで再試行します。',
  );
  await screen.getByRole('button', '取得した本文', { exact: true }).click();
  await expect(browser.locator('.article-body')).toContainText('URLから取得した記事です。');
  await browser.reload();
  await expect(browser.locator('.stock-detail-page')).toBeVisible();
  await expect(browser.locator('.detail-summary')).toContainText(
    '保存と要約を分離し、失敗後も同じストックで再試行します。',
  );
  await screen.getByRole('button', '前の画面に戻る', { exact: true }).click();

  const failedUrl = `https://example.com/pufu-e2e/article?key=${requestId()}&fail=true`;
  await screen.getByRole('button', '記事をストック', { exact: true }).click();
  await screen.getByLabel('投稿URL').fill(failedUrl);
  await screen.getByRole('button', 'ストックする', { exact: true }).click();
  await expect(browser.locator('.article-card .status')).toHaveText('取得失敗', { timeout: 30000 });
  const before = (await fixture.request(`/stocks?project_id=${fixture.projectId}`)) as {
    stocks: { id: string; source_url: string; status: string }[];
  };
  const failed = before.stocks.find((stock) => stock.source_url === failedUrl)!;
  expect(failed.status).toBe('failed');
  await screen.getByRole('button', 'example.com', { exact: true }).click();
  // Prime the old/null body cache before retrying; the page stays mounted after success.
  await screen.getByRole('button', '取得した本文', { exact: true }).click();
  await expect(browser.locator('.article-body')).toBeVisible();
  await screen.getByRole('button', '要約', { exact: true }).click();
  const supplemental =
    '取得できなかった記事の本文を補完します。\n同じストックで再試行し、重複保存しません。'.repeat(
      8,
    );
  await screen.getByLabel('本文を補完して再試行（任意）').fill(supplemental);
  await screen.getByRole('button', 'この本文で再試行', { exact: true }).click();
  await expect(screen.getByRole('dialog')).toHaveCount(0);
  await expect(browser.locator('.stock-detail-page')).toBeVisible();
  await expect(browser.locator('.detail-summary')).toContainText(
    '同じストックで再試行し、重複保存しません。',
  );
  await screen.getByRole('button', '取得した本文', { exact: true }).click();
  await expect(browser.locator('.article-body')).toHaveText(supplemental);
  await browser.reload();
  await expect(browser.locator('.stock-detail-page')).toBeVisible();
  await expect(browser.locator('.detail-summary')).toContainText(
    '同じストックで再試行し、重複保存しません。',
  );
  await screen.getByRole('button', '取得した本文', { exact: true }).click();
  await expect(browser.locator('.article-body')).toHaveText(supplemental);
  const after = (await fixture.request(`/stocks?project_id=${fixture.projectId}`)) as {
    stocks: { id: string; source_url: string; project_id: string; status: string }[];
  };
  expect(after.stocks).toHaveLength(2);
  expect(after.stocks.find((stock) => stock.source_url === sourceUrl)).toMatchObject({
    project_id: fixture.projectId,
    status: 'ready',
  });
  expect(after.stocks.find((stock) => stock.source_url === failedUrl)).toMatchObject({
    id: failed.id,
    project_id: fixture.projectId,
    status: 'ready',
  });
});
