import { setTimeout as delay } from 'node:timers/promises';
import { expect } from 'e2e';
import type { FootprintPoint, OwnedFootprintDetail } from '../../../shared/footprints.ts';
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
    const { id: stockId } = await fixture.request('/stocks', 'POST', {
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
      if (memory?.article_count === index) return String(stockId);
      await delay(250);
    }
    throw new Error('メモリ更新が完了しませんでした。');
  }

  const stockIds: string[] = [];
  for (let index = 1; index <= 4; index++) stockIds.push(await addMemoryStock(index));
  let savedPoints: FootprintPoint[] = [];
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const scheduled = await fetch(`${fixture.url}/api/__e2e__/scheduled?time=${Date.now()}`, {
      method: 'POST',
    });
    expect(scheduled.status).toBe(204);
    const { points } = (await fixture.request(`/projects/${id}/footprints`)) as {
      points: FootprintPoint[];
    };
    savedPoints = points;
    if (points.length >= 4) break;
    await delay(250);
  }

  await app.open(`/#project/${id}`);
  const heading = screen.getByRole('heading', 'プロジェクトの足あと', { exact: true });
  await expect(
    browser.locator('.page-header').getByRole('button', '記事をストック', { exact: true }),
  ).toBeVisible();
  await expect(heading).toHaveCount(0);
  await screen.getByRole('button', 'メモリ・足あと', { exact: true }).click();
  await expect(browser.locator('.memory-page .footprints')).toBeVisible();
  const points = browser.locator('.footprints-timeline button');
  const dialog = screen.getByRole('dialog', 'プロジェクトの足あと', { exact: true });
  const close = screen.getByRole('button', '閉じる', { exact: true });
  expect((await points.allTextContents()).length).toBeGreaterThan(3);
  await expect(points.last()).toHaveAttribute('aria-pressed', 'true');
  await expect(points.last()).toContainText('続く');
  await expect(points.last()).toBeDisabled();
  await expect(dialog).toHaveCount(0);
  const mobile = await browser.evaluate(() => window.matchMedia('(max-width:760px)').matches);
  if (mobile) {
    expect(
      await browser.evaluate(() => document.querySelector('.footprints-timeline')!.scrollLeft),
    ).toBeGreaterThan(0);
  }
  await points.first().click();
  await expect(dialog).toBeVisible();
  await expect(
    screen.getByRole('heading', 'プロジェクトのはじまり', { exact: true }),
  ).toBeVisible();

  const detailPath = (revision: number) => `/projects/${id}/footprints/${revision}`;
  const firstPath = detailPath(savedPoints[0].revision);
  const original = (await fixture.request(firstPath)) as unknown as OwnedFootprintDetail;
  await screen.getByRole('button', 'この期間を再分析', { exact: true }).click();
  await expect(screen.getByText('再分析の結果を保存しました。', { exact: true })).toBeVisible();
  await screen.getByRole('button', '元の分析を見る', { exact: true }).click();
  await screen.getByRole('button', '再分析の結果を見る', { exact: true }).click();
  const reanalyzed = (await fixture.request(firstPath)) as unknown as OwnedFootprintDetail;
  expect(reanalyzed.reanalysis).toMatchObject({
    status: 'ready',
    result: { start_at: original.start_at, end_at: original.end_at },
  });
  expect(reanalyzed.analysis).toEqual(original.analysis);
  await browser.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  if (!mobile)
    expect(
      await browser.evaluate(() =>
        Boolean(document.activeElement?.classList.contains('footprints-point')),
      ),
    ).toBe(true);

  const evidence = { kind: 'stock', id: stockIds[3], label: '記録 4' } as const;
  const change = 'コード品質を確認する工程が判断材料に加わった。';
  const quote = '比較した記事を読んで、確認する工程を見直した。';
  let preview: 'change' | 'legacy' | null = 'change';
  // The local demo uses extractive output. Exercise the two stored detail formats with fixtures.
  await browser.route(`${fixture.url}/api/v1${firstPath}`, (route) => {
    if (!preview) return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...original,
        kind: preview === 'change' ? 'deepening' : original.kind,
        analysis:
          preview === 'change'
            ? {
                ...original.analysis,
                title: 'エージェント運用の見直し',
                kind: 'deepening',
                before: '開発の自動化について調べていた。',
                current: '実際の運用を設計するための判断材料が加わった。',
                changes: [{ text: change, links: [evidence] }],
                triggers: [quote],
                trigger_details: [
                  { text: quote, links: [{ kind: 'stock', id: stockIds[2], label: '記録 3' }] },
                ],
                interpretation: '品質管理への関心が具体化した可能性がある。',
              }
            : {
                ...original.analysis,
                changes: undefined,
                trigger_details: undefined,
                interpretation: undefined,
                triggers: ['以前の足あとに保存された記録。'],
              },
        links: [evidence],
      }),
    });
  });
  await points.first().click();
  await expect(screen.getByRole('heading', 'エージェント運用の見直し')).toBeVisible();
  expect(await browser.locator('.footprints-detail h4').allTextContents()).toEqual([
    '以前',
    '今回',
    '変化と根拠',
    '本人の記録にあるきっかけ',
    'AIの解釈',
  ]);
  const changeItem = browser.locator('.footprints-statements > li').first();
  await expect(changeItem).toContainText(change);
  const citation = changeItem.getByRole('link', '記録 4', { exact: true });
  await expect(citation).toHaveAttribute('href', `#stock/${stockIds[3]}`);
  await expect(screen.getByRole('link', '記録 4', { exact: true })).toHaveCount(1);
  await expect(browser.locator('.footprints-statements q')).toHaveText(quote);
  await close.click();
  preview = 'legacy';
  await points.first().click();
  await expect(points.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(
    screen.getByRole('heading', 'プロジェクトのはじまり', { exact: true }),
  ).toBeVisible();
  await expect(screen.getByRole('heading', '関連する記録')).toBeVisible();
  await expect(screen.getByText('以前の足あとに保存された記録。')).toBeVisible();
  await expect(screen.getByRole('heading', '本人の記録にあるきっかけ')).toHaveCount(0);
  preview = null;
  await close.click();
  await expect(dialog).toHaveCount(0);

  await app.open('/#memory');
  await expect(browser.locator('.memory-page .full-memory')).toBeVisible();
  await expect(screen.getByRole('button', 'メモリ', { exact: true })).toBeVisible();
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
  await fixture.request(`${detailPath(savedPoints.at(-1)!.revision)}/publication`, 'PATCH', {
    title: '公開済みだった続く',
    summary: '詳細なしのタイムライン表示',
  });
  await points.first().click();
  await expect(
    screen.getByText('再分析すると、公開されている記録から作った分析を公開ページにも表示します。'),
  ).toBeVisible();
  await screen.getByRole('button', 'この期間を再分析', { exact: true }).click();
  await expect(screen.getByText('再分析の結果を保存しました。', { exact: true })).toBeVisible();
  const owner = (await fixture.request(firstPath)) as unknown as OwnedFootprintDetail;
  expect(owner.shared).toMatchObject({
    kind: 'beginning',
    analysis: { title: 'プロジェクトのはじまり' },
  });
  await expect(screen.getByLabel('公開用タイトル')).toHaveCount(0);
  const period = await browser.locator('.footprints-period').textContent();
  await close.click();

  const cookies = await browser.cookies();
  await app.clearState();
  await app.open(publicPage);
  const tab = screen.getByRole('link', '足あと', { exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-current', 'page');
  await expect(points).toHaveCount(2);
  await expect(points.last()).toHaveAttribute('aria-pressed', 'true');
  await expect(points.last()).toBeDisabled();
  await expect(screen.getByRole('heading', '公開済みだった続く', { exact: true })).toHaveCount(0);
  await expect(browser.locator('article.footprints-detail')).toHaveCount(0);
  await points.first().click();
  await expect(
    screen.getByRole('heading', 'プロジェクトのはじまり', { exact: true }),
  ).toBeVisible();
  await expect(browser.locator('.footprints-period')).toHaveText(period!);
  await expect(dialog).toHaveCount(0);
  await app.open(`${publicPage}?view=footprints`);
  await expect(points).toHaveCount(2);
  await expect(points.last()).toBeDisabled();
  await browser.setCookies(cookies);
});
