import { readFile } from 'node:fs/promises';
import { expect } from 'e2e';
import { test, requestId } from '../src/fixtures.ts';
import type { ProfileUsage, UsagePeriod } from '../../../shared/profile-usage.ts';

test('USAGE-001 プロフィールの利用状況を期間別に確認し再読込後も集計を表示する', async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  await fixture.request(`/projects/${fixture.projectId}`, 'PATCH', {
    name: fixture.projectName,
    show_in_all_lists: false,
    auto_generate_questions: false,
  });
  const before = (await fixture.request('/me/usage')) as ProfileUsage;
  await fixture.request('/stocks', 'POST', {
    project_id: fixture.projectId,
    type: 'text',
    text: '利用状況の確認用ストック',
    skip_summary: true,
  });
  await fixture.request('/questions', 'POST', {
    project_id: fixture.projectId,
    text: '利用状況を確認できるか？',
  });
  const score = JSON.parse(
    await readFile(new URL('../../../tests/fixtures/pufu-sparse.json', import.meta.url), 'utf8'),
  );
  await fixture.request('/pufus', 'POST', {
    project_id: fixture.projectId,
    request_id: requestId(),
    score,
  });
  const expected = (await fixture.request('/me/usage')) as ProfileUsage;
  expect(expected.periods.all.stocks).toBe(before.periods.all.stocks + 1);
  expect(expected.periods.all.questions).toBe(before.periods.all.questions + 1);
  expect(expected.periods.all.pufus).toBe(before.periods.all.pufus + 1);
  expect(expected.periods.all.ai_neurons).toBe(0);
  await browser.emulateMedia({ colorScheme: 'light' });
  await app.open('/#profile');
  await expect(screen.getByRole('heading', '利用状況', { exact: true })).toBeVisible();
  await expect(browser.locator('.appearance-settings + .usage-card')).toBeVisible();
  const check = async (period: UsagePeriod) => {
    for (const key of ['stocks', 'questions', 'pufus', 'ai_neurons'] as const) {
      await expect(browser.locator(`.usage-metrics [data-metric="${key}"] strong`)).toHaveText(
        expected.periods[period][key].toLocaleString('ja-JP', { maximumFractionDigits: 0 }),
      );
    }
  };
  await expect(screen.getByRole('radio', '今週', { exact: true })).toBeChecked();
  await check('week');
  await expect(browser.locator('[data-metric="ai_neurons"] dd')).toContainText('Neurons');
  await screen.getByRole('radio', '今月', { exact: true }).check();
  await check('month');
  await screen.getByRole('radio', '全体', { exact: true }).check();
  await check('all');
  await browser.evaluate(() => {
    document.querySelector('.appearance-settings')!.scrollIntoView({ block: 'start' });
    return null;
  });
  await app.screenshot('profile-usage-light');
  await browser.emulateMedia({ colorScheme: 'dark' });
  await expect(browser.locator('html')).toHaveAttribute('data-theme', 'dark');
  await app.screenshot('profile-usage-dark');
  expect(
    await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await browser.reload();
  await check('week');
  await screen.getByRole('radio', '全体', { exact: true }).check();
  await check('all');
  await app.open('/manual');
  await expect(browser.locator('.manual-start')).toContainText(
    '「プロフィール」で「表示設定」の下にある「利用状況」',
  );
  await app.screenshot('manual-usage-dark');
  await browser.emulateMedia({ colorScheme: 'light' });
  await app.screenshot('manual-usage-light');
});
