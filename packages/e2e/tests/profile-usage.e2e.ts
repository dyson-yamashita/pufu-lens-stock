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
  await expect(browser.locator('.usage-card + .appearance-settings')).toBeVisible();
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
    document.querySelector('.usage-card')!.scrollIntoView({ block: 'start' });
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
  await browser.locator('.manual-start summary').getByText('利用状況', { exact: true }).click();
  await expect(browser.locator('.manual-start details[open] p')).toContainText(
    '「プロフィール」の「利用状況」',
  );
  await app.screenshot('manual-usage-dark');
  await browser.emulateMedia({ colorScheme: 'light' });
  await app.screenshot('manual-usage-light');

  // Basic steps stay visible; supplementary topics open independently with native keyboard support.
  for (const path of ['/manual', '/en/manual']) {
    await app.open(path);
    await expect(browser.locator('.manual-topics details[open]')).toHaveCount(0);
    await browser.locator('.manual-toc a[href="#pufu"]').click();
    await expect(browser.locator('#pufu h3').first()).toBeVisible();
    const checkPufuAnchor = async () => {
      expect(
        await browser.evaluate(() => {
          const top = document.getElementById('pufu')!.getBoundingClientRect().top;
          return { hash: window.location.hash, inView: top >= 0 && top <= 80 };
        }),
      ).toEqual({ hash: '#pufu', inView: true });
    };
    await checkPufuAnchor();
    await expect(browser.locator('#pufu > .manual-guide > ol')).toBeVisible();
    const sources = browser.locator('#pufu details:nth-child(1) > p').first();
    const editor = browser.locator('#pufu details:nth-child(2) > p').first();
    await expect(sources).toBeHidden();
    await browser.locator('#pufu details:nth-child(1) > summary').click();
    await expect(sources).toBeVisible();
    await expect(editor).toBeHidden();
    await browser.locator('#pufu details:nth-child(2) > summary').click();
    await expect(editor).toBeVisible();
    await browser.keyboard.press('Enter');
    await expect(editor).toBeHidden();
    await browser.keyboard.press('Space');
    await expect(editor).toBeVisible();
    await expect(sources).toBeVisible();
    for (const theme of ['light', 'dark'] as const) {
      await browser.emulateMedia({ colorScheme: theme });
      await expect(browser.locator('html')).toHaveAttribute('data-theme', theme);
      expect(
        await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await app.screenshot(`manual-pufu-${path === '/manual' ? 'ja' : 'en'}-${theme}`);
    }
    // Short chapters keep their privacy note visible while optional instructions stay collapsed.
    await expect(browser.locator('#sharing > .manual-guide > .manual-note')).toBeVisible();
    await expect(browser.locator('#skills > .manual-guide > .manual-note')).toBeVisible();
    for (const section of ['comments', 'memory', 'sharing', 'integrations', 'skills']) {
      const content = browser.locator(`#${section} details:first-child > :is(p, ol)`).first();
      await expect(content).toBeHidden();
      await browser.locator(`#${section} details:first-child > summary`).click();
      await expect(content).toBeVisible();
    }
    await app.open(`${path}#help`);
    const intro = browser.locator('#help > .manual-guide > p');
    const consult = browser.locator('#help > .manual-guide > h3');
    const entry = browser.locator('#help > .manual-guide > ul');
    await expect(intro).toBeVisible();
    await expect(consult).toHaveText(path === '/manual' ? 'プフィに相談する' : 'Talk to Pufi');
    await expect(consult).toBeVisible();
    await expect(entry).toBeVisible();
    await expect(browser.locator('#help details')).toHaveCount(4);
    await expect(browser.locator('#help details[open]')).toHaveCount(0);
    for (const theme of ['light', 'dark'] as const) {
      await browser.emulateMedia({ colorScheme: theme });
      await expect(browser.locator('html')).toHaveAttribute('data-theme', theme);
      await browser.evaluate(() => {
        document.querySelector('#help')!.scrollIntoView({ block: 'start' });
        return null;
      });
      await app.screenshot(`manual-help-${path === '/manual' ? 'ja' : 'en'}-${theme}-collapsed`);
      for (let index = 1; index <= 4; index++) {
        const summary = browser.locator(`#help details:nth-child(${index}) > summary`);
        const content = browser.locator(`#help details:nth-child(${index}) > ul`);
        await expect(content).toBeHidden();
        await summary.click();
        await expect(content).toBeVisible();
        await expect(browser.locator('#help details[open]')).toHaveCount(index);
        expect(
          await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
      }
      await browser.evaluate(() => {
        document.querySelector('#help')!.scrollIntoView({ block: 'start' });
        return null;
      });
      await app.screenshot(`manual-help-${path === '/manual' ? 'ja' : 'en'}-${theme}-expanded`);
      for (let index = 1; index <= 4; index++) {
        await browser.locator(`#help details:nth-child(${index}) > summary`).click();
        await expect(browser.locator(`#help details:nth-child(${index}) > ul`)).toBeHidden();
      }
      await expect(intro).toBeVisible();
      await expect(entry).toBeVisible();
    }
    await app.open(`${path}#pufu`);
    await expect(browser.locator('#pufu h3').first()).toBeVisible();
    await checkPufuAnchor();
  }
});
