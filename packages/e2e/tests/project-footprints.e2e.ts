import { setTimeout as delay } from 'node:timers/promises';
import { expect } from 'e2e';
import { test } from '../src/fixtures.ts';

test('FOOTPRINT-001 保存した間隔で足あとを作り、ストックの先頭だけで詳細を開ける', async ({
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
  await expect(automatic).toBeChecked();
  await expect(interval).toHaveValue('3');
  await interval.selectOption({ label: '1回' });
  await screen.getByRole('button', '保存', { exact: true }).click();
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
  for (let index = 0; index < 21; index++) {
    await fixture.request('/stocks', 'POST', {
      project_id: id,
      type: 'url',
      url: `https://www.youtube.com/playlist?list=e2e-footprints-${index}`,
    });
  }
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
  const points = browser.locator('.footprints-timeline button');
  const heading = screen.getByRole('heading', 'プロジェクトの足あと', { exact: true });
  const toggle = browser.locator('.footprints-toggle');
  await expect(heading).toBeVisible();
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

  const pagination = browser.locator('.pagination');
  await pagination.getByRole('button', '次へ', { exact: true }).click();
  await expect(heading).toHaveCount(0);
  await pagination.getByRole('button', '前へ', { exact: true }).click();
  await expect(heading).toBeVisible();
  await screen.getByRole('button', 'メモリ', { exact: true }).click();
  await expect(heading).toHaveCount(0);

  await app.open(`/#settings/${id}`);
  await advanced.click();
  await automatic.click();
  await screen.getByRole('button', '保存', { exact: true }).click();
  await expect(screen.getByText('プロジェクトの設定を保存しました。')).toBeVisible();
  await screen.getByRole('button', '過去の足あとを生成', { exact: true }).click();
  await expect(screen.getByText(/過去の足あとの生成を受け付けました/)).toBeVisible();
  await app.open(`/#project/${id}`);
  await expect(heading).toBeVisible();
});
