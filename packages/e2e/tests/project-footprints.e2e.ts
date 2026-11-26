import { setTimeout as delay } from 'node:timers/promises';
import { expect } from 'e2e';
import { test } from '../src/fixtures.ts';

test('FOOTPRINT-001 保存した間隔で足あとを作り、プロジェクトのメモリタブで詳細を開ける', async ({
  app,
  browser,
  screen,
  fixture,
}) => {
  const id = fixture.projectId;
  await app.open(`/#settings/${id}`);
  const advanced = browser.locator('.project-advanced summary');
  await advanced.click();
  const automatic = screen.getByRole('switch', '足あとの自動追加', { exact: true });
  const interval = screen.getByRole('combobox', '足あとの追加間隔', { exact: true });
  const save = screen.getByRole('button', '保存', { exact: true });
  await expect(automatic).toBeChecked();
  await expect(interval).toHaveValue('3');
  await interval.selectOption({ label: '1回' });
  await save.click();
  await expect(save).toBeEnabled();
  await expect(screen.getByText('プロジェクトの設定を保存しました。')).toBeVisible();
  await browser.reload();
  await advanced.click();
  await expect(interval).toHaveValue('1');

  async function addMemoryStock(index: number) {
    await fixture.request('/stocks', 'POST', {
      project_id: id,
      type: 'text',
      title: `記録 ${index}`,
      text: `プロジェクトで観察した変化の実践記録 ${index}。`,
    });
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const { memory } = (await fixture.request(`/memory?project_id=${id}`)) as {
        memory?: { article_count: number };
      };
      if (memory?.article_count === index) return;
      await delay(250);
    }
    throw new Error('メモリ更新が完了しませんでした。');
  }

  for (let index = 1; index <= 4; index++) await addMemoryStock(index);
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const scheduled = await fetch(`${fixture.url}/api/__e2e__/scheduled?time=${Date.now()}`, {
      method: 'POST',
    });
    expect(scheduled.status).toBe(204);
    const { points } = (await fixture.request(`/projects/${id}/footprints`)) as {
      points: unknown[];
    };
    if (points.length >= 4) break;
    await delay(250);
  }

  await app.open(`/#project/${id}`);
  const heading = screen.getByRole('heading', 'プロジェクトの足あと', { exact: true });
  await expect(
    browser.locator('.page-header').getByRole('button', '記事をストック', { exact: true }),
  ).toBeVisible();
  await expect(heading).toHaveCount(0);
  await screen.getByRole('button', 'メモリ', { exact: true }).click();
  await expect(browser.locator('.memory-page .footprints')).toBeVisible();
  const points = browser.locator('.footprints-timeline button');
  const toggle = browser.locator('.footprints-toggle');
  expect((await points.allTextContents()).length).toBeGreaterThan(3);
  await expect(points.last()).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const mobile = await browser.evaluate(() => window.matchMedia('(max-width:760px)').matches);
  if (mobile) {
    expect(
      await browser.evaluate(() => document.querySelector('.footprints-timeline')!.scrollLeft),
    ).toBeGreaterThan(0);
  }
  await toggle.click();
  await expect(
    screen.getByRole('heading', 'プロジェクトの記録が続く', { exact: true }),
  ).toBeVisible();
  await points.first().click();
  await expect(points.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(
    screen.getByRole('heading', 'プロジェクトのはじまり', { exact: true }),
  ).toBeVisible();
  await screen.getByRole('button', '詳細を閉じる', { exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await app.open('/#memory');
  await expect(browser.locator('.memory-page .full-memory')).toBeVisible();
  await expect(heading).toHaveCount(0);

  await app.open(`/#settings/${id}`);
  await advanced.click();
  await automatic.click();
  await save.click();
  await expect(save).toBeEnabled();
  await expect(screen.getByText('プロジェクトの設定を保存しました。')).toBeVisible();
  await screen.getByRole('button', '過去の足あとを生成', { exact: true }).click();
  await expect(screen.getByText(/過去の足あとの生成を受け付けました/)).toBeVisible();
  await app.open(`/#memory/${id}`);
  await expect(heading).toBeVisible();

  // The saved setting must be reflected during navigation even while the list refresh is delayed.
  let delayedProjectReads = 0;
  let releaseProjectReads!: () => void;
  const pendingProjectReads = new Promise<void>((resolve) => {
    releaseProjectReads = resolve;
  });
  await browser.route(`${fixture.url}/api/v1/projects?include_reflections=true`, async (route) => {
    delayedProjectReads++;
    await pendingProjectReads;
    await route.continue();
  });
  try {
    for (const enabled of [false, true]) {
      await app.open(`/#settings/${id}`);
      await advanced.click();
      const memoryUpdate = screen.getByRole(
        'switch',
        'ストック追加時にユーザーのメモリを更新する',
        { exact: true },
      );
      if (enabled) await expect(memoryUpdate).not.toBeChecked();
      else await expect(memoryUpdate).toBeChecked();
      await memoryUpdate.click();
      await save.click();
      await expect(save).toBeEnabled();
      await expect(screen.getByText('プロジェクトの設定を保存しました。')).toBeVisible();
      await app.open(`/#memory/${id}`);
      await expect(
        screen.getByRole('heading', `${fixture.projectName}のメモリ`, { exact: true }),
      ).toBeVisible();
      if (enabled) await expect(heading).toBeVisible();
      else await expect(heading).toHaveCount(0);
    }
    expect(delayedProjectReads).toBeGreaterThan(0);
  } finally {
    releaseProjectReads();
  }

  const { publication } = (await fixture.request(`/projects/${id}/publication`, 'PATCH', {
    is_public: true,
    public_description: '',
  })) as { publication: { public_id: string } };
  const publicPage = `/p/${publication.public_id}`;
  await toggle.click();
  const editor = browser.locator('.footprints-publication summary');
  const title = screen.getByLabel('公開用タイトル', { exact: true });
  const summary = screen.getByLabel('公開用の説明', { exact: true });
  for (const [point, heading, text] of [
    [points.last(), '公開する見直し', '実践を続けて見直したこと。'],
    [points.first(), '公開するはじまり', '記録を始めたきっかけ。'],
  ] as const) {
    await point.click();
    await editor.click();
    await expect(title).toHaveValue('');
    await title.fill(heading);
    await summary.fill(text);
    await screen.getByRole('button', '公開ページに掲載', { exact: true }).click();
    await expect(screen.getByText('公開ページに掲載しました。', { exact: true })).toBeVisible();
  }

  const cookies = await browser.cookies();
  await app.clearState();
  await app.open(publicPage);
  const tab = screen.getByRole('link', '足あと', { exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-current', 'page');
  await expect(points).toHaveCount(2);
  await expect(points.last()).toHaveAttribute('aria-pressed', 'true');
  await expect(screen.getByRole('heading', '公開する見直し', { exact: true })).toBeVisible();
  await expect(screen.getByText('実践を続けて見直したこと。', { exact: true })).toBeVisible();
  await expect(
    screen.getByRole('heading', 'プロジェクトの記録が続く', { exact: true }),
  ).toHaveCount(0);
  await points.first().click();
  await expect(screen.getByRole('heading', '公開するはじまり', { exact: true })).toBeVisible();

  await browser.setCookies(cookies);
  await app.open(`/#memory/${id}`);
  await toggle.click();
  await editor.click();
  await expect(title).toHaveValue('公開する見直し');
  await screen.getByRole('button', '掲載を取り消す', { exact: true }).click();
  await expect(screen.getByText('掲載を取り消しました。', { exact: true })).toBeVisible();
  await app.clearState();
  await app.open(`${publicPage}?view=footprints`);
  await expect(points).toHaveCount(1);
  await expect(screen.getByRole('heading', '公開するはじまり', { exact: true })).toBeVisible();
});
