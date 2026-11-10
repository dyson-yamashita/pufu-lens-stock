import { expect } from 'e2e';
import { test } from '../src/fixtures.ts';
import { setTimeout as delay } from 'node:timers/promises';

test('MEMORY-001 メモリの過去版を開き最新へ戻り再読込後も履歴を読める', async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  const request = fixture.request;
  const query = `?project_id=${fixture.projectId}`;
  async function waitCount(count: number) {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const value = (await request(`/memory${query}`)) as {
        memory?: { article_count: number; revision: number };
      };
      if (value.memory?.article_count === count) {
        const history = (await request(`/memory/history${query}`)) as {
          versions: { revision: number }[];
        };
        if (history.versions.some((v) => v.revision === value.memory!.revision))
          return value.memory.revision;
      }
      await delay(250);
    }
    throw new Error('メモリ履歴が保存されませんでした。');
  }
  await request('/stocks', 'POST', {
    type: 'text',
    project_id: fixture.projectId,
    title: '情報を集める入口',
    text: '気になる情報から問いを育てる。人が気になった理由を手掛かりに、次の行動を考える。',
  });
  const first = await waitCount(1);
  await request('/stocks', 'POST', {
    type: 'text',
    project_id: fixture.projectId,
    title: '三つの入口へ',
    text: '情報・問い・行動を行き来する。目標があるときはプ譜から始め、実践の経験から問いを見直せるようにする。',
  });
  await waitCount(2);
  await browser.emulateMedia({ colorScheme: 'light' });
  await app.open(`/#memory/${fixture.projectId}`);
  const panelBackground = () =>
    browser.evaluate(
      () => getComputedStyle(document.querySelector('.full-memory')!).backgroundColor,
    );
  await expect(browser.locator('.full-memory')).toBeVisible();
  expect(await panelBackground()).toBe('rgb(255, 255, 255)');
  await browser.emulateMedia({ colorScheme: 'dark' });
  await expect(browser.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await panelBackground()).toBe('rgb(22, 38, 48)');
  await browser.emulateMedia({ colorScheme: 'light' });
  await screen.getByRole('button', 'メモリの履歴', { exact: true }).click();
  const old = browser.locator('.memory-version').filter({ hasText: `第${first}版 · 1件の記事` });
  await expect(old).toBeVisible();
  await old.click();
  await expect(screen.getByText(`第${first}版を表示中`, { exact: true })).toBeVisible();
  await expect(browser.locator('.memory-foot')).toContainText('1記事から生成');
  await expect(screen.getByRole('button', '再生成', { exact: true })).toBeDisabled();
  await app.screenshot('memory-history-past');
  await browser.locator('.memory-version').filter({ hasText: '最新のメモリ' }).click();
  await expect(browser.locator('.memory-foot')).toContainText('2記事から生成');
  await expect(screen.getByRole('button', '再生成', { exact: true })).toBeEnabled();
  await browser.reload();
  await screen.getByRole('button', 'メモリの履歴', { exact: true }).click();
  await browser
    .locator('.memory-version')
    .filter({ hasText: `第${first}版 · 1件の記事` })
    .click();
  await expect(screen.getByText(`第${first}版を表示中`, { exact: true })).toBeVisible();
});
