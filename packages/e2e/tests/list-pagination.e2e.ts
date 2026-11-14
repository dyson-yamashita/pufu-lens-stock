import { expect } from 'e2e';
import { test } from '../src/fixtures.ts';

test('LIST-001 ストックと問いのスマホ表示件数とページ切替時の先頭移動', async ({
  app,
  browser,
  fixture,
}) => {
  await fixture.request(`/projects/${fixture.projectId}`, 'PATCH', {
    name: fixture.projectName,
    description: 'ページ切替の検証用',
    auto_generate_questions: false,
  });
  for (let index = 0; index < 25; index++) {
    // URLのみ保存するリンクを使い、ページ分割のデータ作成でメモリ生成枠を消費しない。
    const { id } = await fixture.request('/stocks', 'POST', {
      project_id: fixture.projectId,
      type: 'url',
      url: `https://www.youtube.com/playlist?list=e2e-pagination-${index}`,
    });
    await fixture.request(`/stocks/${id}/title`, 'PATCH', {
      title: `ページ確認ストック${index}`,
    });
    await fixture.request('/questions', 'POST', {
      project_id: fixture.projectId,
      text: `ページ確認の問い${index}？`,
    });
  }
  const mobile = await browser.evaluate(() => window.matchMedia('(max-width: 760px)').matches);
  const pageSize = mobile ? 6 : 24;
  const pages = Math.ceil(25 / pageSize);
  for (const view of ['stocks', 'questions']) {
    await app.open(view === 'stocks' ? '/#' : '/#questions');
    await browser.locator('#project-scope').selectOption({ value: fixture.projectId });
    const cards = browser.locator(view === 'stocks' ? '.article-card' : '.question-card');
    const titles = browser.locator(view === 'stocks' ? '.article-open' : '.question-open');
    const pagination = browser.locator('.pagination');
    const next = pagination.getByRole('button', '次へ', { exact: true });
    const previous = pagination.getByRole('button', '前へ', { exact: true });
    await expect(cards).toHaveCount(pageSize);
    await expect(pagination).toContainText(`1 / ${pages}`);
    await expect(previous).toBeDisabled();
    const firstPage = await titles.allTextContents();
    await next.click();
    await expect(pagination).toContainText(`2 / ${pages}`);
    await expect(titles.first()).not.toHaveText(firstPage[0]);
    await expect(cards).toHaveCount(mobile ? 6 : 1);
    const secondPage = await titles.allTextContents();
    expect(secondPage.some((card) => firstPage.includes(card))).toBe(false);
    if (mobile) expect(await browser.evaluate(() => window.scrollY)).toBe(0);
    await previous.click();
    await expect(pagination).toContainText(`1 / ${pages}`);
    await expect(titles.first()).toHaveText(firstPage[0]);
    await expect(cards).toHaveCount(pageSize);
    expect(await titles.allTextContents()).toEqual(firstPage);
    if (mobile) expect(await browser.evaluate(() => window.scrollY)).toBe(0);
    for (let page = 2; page <= pages; page++) {
      const currentFirst = await titles.first().textContent();
      await next.click();
      await expect(pagination).toContainText(`${page} / ${pages}`);
      await expect(titles.first()).not.toHaveText(currentFirst!);
      await expect(cards).toHaveCount(page === pages ? 1 : pageSize);
    }
    await expect(next).toBeDisabled();
  }
});
