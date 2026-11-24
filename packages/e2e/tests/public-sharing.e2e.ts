import { readFile } from 'node:fs/promises';
import { expect } from 'e2e';
import { requestId, test } from '../src/fixtures.ts';

test('PUBLIC-002 公開中の項目と表示中のプ譜局面を共有する', async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  const share = screen.getByRole('button', '共有', { exact: true });
  const link = screen.getByLabel('公開リンク', { exact: true });
  const settings = `/projects/${fixture.projectId}/publication`;

  async function expectShareAlignedLeft() {
    const offset = await browser.evaluate(() => {
      const button = document.querySelector('.share-link');
      const anchor = button?.closest('.share-anchor');
      if (!button || !anchor) return null;
      return button.getBoundingClientRect().left - anchor.getBoundingClientRect().left;
    });
    expect(offset).toBe(0);
  }

  await app.open(`/#project/${fixture.projectId}`);
  await share.click();
  await expect(screen.getByText('このプロジェクトは非公開です。')).toBeVisible();
  await expect(screen.getByRole('link', '公開設定を確認')).toHaveAttribute(
    'href',
    `#settings/${fixture.projectId}`,
  );
  await expect(link).toHaveCount(0);
  await screen.getByRole('button', '共有を閉じる', { exact: true }).click();

  const stock = await fixture.request('/stocks', 'POST', {
    project_id: fixture.projectId,
    type: 'text',
    title: '共有するストック',
    text: '共有するストックの本文',
    skip_summary: true,
  });
  const { question } = (await fixture.request('/questions', 'POST', {
    project_id: fixture.projectId,
    stock_ids: [stock.id],
    text: '共有する問い',
  })) as { question: { id: string } };
  const score = JSON.parse(
    await readFile(new URL('../../../tests/fixtures/pufu-sparse.json', import.meta.url), 'utf8'),
  );
  const { pufu } = (await fixture.request('/pufus', 'POST', {
    project_id: fixture.projectId,
    question_id: question.id,
    title: '共有するプ譜',
    request_id: requestId(),
    score,
  })) as { pufu: { id: string } };
  await fixture.request(`/pufus/${pufu.id}/phases`, 'POST', { revision: 1, phase: 1, score });
  const { publication } = (await fixture.request(settings, 'PATCH', {
    is_public: true,
    public_description: '',
  })) as {
    publication: { public_id: string };
  };
  const base = `/p/${publication.public_id}`;
  const pufuPath = `${base}/pufus/${pufu.id}`;
  const pages = [
    [`/#project/${fixture.projectId}`, `${base}?view=questions&page=2`, base],
    [`/#stock/${stock.id}`, `${base}/stocks/${stock.id}?page=2`, `${base}/stocks/${stock.id}`],
    [
      `/#question/${question.id}`,
      `${base}/questions/${question.id}?page=2`,
      `${base}/questions/${question.id}`,
    ],
    [`/#pufu/${pufu.id}`, `${pufuPath}?from=pufus`, `${pufuPath}?phase=2`],
  ];
  for (const [owner, , canonical] of pages) {
    await app.open(owner);
    await share.click();
    await expect(link).toHaveValue(`${fixture.url}${canonical}`);
    await expectShareAlignedLeft();
  }
  const firstPhaseUrl = `${fixture.url}${pufuPath}?phase=1`;
  await screen.getByRole('button', '前の局面へ').click();
  await expect(screen.getByRole('heading', '第1局面を共有')).toBeVisible();
  await expect(link).toHaveValue(firstPhaseUrl);

  const unlinked = (await fixture.request('/pufus', 'POST', {
    project_id: fixture.projectId,
    request_id: requestId(),
    score,
  })) as { pufu: { id: string } };
  await app.open(`/#pufu/${unlinked.pufu.id}`);
  await share.click();
  await expect(screen.getByText('公開されているページが見つかりません。')).toBeVisible();
  await expect(link).toHaveCount(0);

  await app.clearState();
  const copyLink = screen.getByRole('button', 'リンクをコピー', { exact: true });
  const nativeShare = screen.getByRole('button', '別のアプリで共有', { exact: true });
  for (const [, publicPage, canonical] of pages) {
    await app.open(publicPage);
    await expect(share).toHaveCount(1);
    await share.click();
    await expect(link).toHaveValue(`${fixture.url}${canonical}`);
    await expectShareAlignedLeft();
    expect(
      await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    if (canonical === base) {
      const lastAction = (await nativeShare.isVisible()) ? nativeShare : copyLink;
      await lastAction.press('Tab');
      await expect(link).toHaveCount(0);
    }
  }

  await browser.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (url: string) => {
          document.documentElement.dataset.copied = url;
        },
      },
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        document.documentElement.dataset.shared = JSON.stringify(data);
      },
    });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    return null;
  });
  await screen.getByRole('button', '前の局面へ').click();
  await expect(screen.getByRole('heading', '第1局面を共有')).toBeVisible();
  await expect(link).toHaveValue(firstPhaseUrl);

  expect(
    await browser.evaluate(() => {
      const input = document.querySelector('.share-panel input');
      const copy = document.querySelector('.share-panel button[aria-label="リンクをコピー"]');
      if (!input || !copy) return null;
      const field = input.getBoundingClientRect();
      const button = copy.getBoundingClientRect();
      return {
        besideLink:
          button.left >= field.right && button.top < field.bottom && button.bottom > field.top,
        text: copy.textContent?.trim(),
      };
    }),
  ).toEqual({ besideLink: true, text: '' });
  await copyLink.click();
  await expect(browser.locator('html')).toHaveAttribute('data-copied', firstPhaseUrl);
  await expect(screen.getByText('リンクをコピーしました。')).toBeVisible();
  await nativeShare.click();
  await expect(browser.locator('html')).toHaveAttribute(
    'data-shared',
    JSON.stringify({ url: firstPhaseUrl }),
  );
  await browser.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    return null;
  });
  await copyLink.click();
  await expect(screen.getByText('選択されたリンクをコピーしてください。')).toBeVisible();
  expect(
    await browser.evaluate(() => {
      const input = document.activeElement;
      return input instanceof HTMLInputElement
        ? input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)
        : null;
    }),
  ).toBe(firstPhaseUrl);
  await screen.getByRole('button', '共有を閉じる', { exact: true }).click();
  await expect(link).toHaveCount(0);

  await app.open(`${pufuPath}?phase=1`);
  await expect(browser.locator('.pufu-phase-number')).toHaveText('第1局面');
  await fixture.request(settings, 'PATCH', { is_public: false, public_description: '' });
  expect((await fetch(firstPhaseUrl)).status).toBe(404);
});
