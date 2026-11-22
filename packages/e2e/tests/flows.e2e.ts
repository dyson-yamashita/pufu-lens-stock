import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect } from 'e2e';
import { publicListPageSize } from '../../../shared/public-project.ts';
import { test, requestId } from '../src/fixtures.ts';
import { goals } from '../src/executor.ts';

const sourceText = 'E2Eで保存した本文\n保存した内容を再読み込みして確認します。';
test('STOCK-001 テキストを保存して再読込しても本文と保存先が残る', async ({
  app,
  screen,
  browser,
  agent,
  fixture,
}) => {
  await app.open(`/#project/${fixture.projectId}`);
  await agent.act(goals.stock);
  await expect(screen.getByRole('dialog', '記事をストック')).toBeVisible();
  await screen.getByRole('tab', 'テキスト').click();
  await screen.getByLabel('本文').fill(sourceText);
  let failFirstImage = true;
  await browser.route('**/api/v1/stocks/*/images', async (route) => {
    if (route.request.method === 'POST' && failFirstImage) {
      failFirstImage = false;
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'E2E一時的な画像保存失敗' }),
      });
    }
    await route.continue();
  });
  await browser
    .locator('#new-stock-images')
    .setInputFiles(
      fileURLToPath(new URL('../../../tests/fixtures/stock-image.png', import.meta.url)),
    );
  await screen.getByRole('button', 'ストックする').click();
  await expect(screen.getByText('ストックは保存済みです。', { exact: true })).toBeVisible();
  await screen.getByRole('button', '未保存の画像を再試行').click();
  await expect(screen.getByRole('heading', 'E2Eで保存した本文')).toBeVisible();
  await app.open(`/#project/${fixture.projectId}`);
  const previews = browser.locator('.article-image-previews img');
  const previewPosition = browser.locator('.article-image-previews .stock-image-position');
  await expect(screen.getByRole('group', '画像', { exact: true })).toHaveCount(1);
  await expect(previews).toHaveCount(1);
  await expect(previews).toHaveAttribute('alt', 'stock-image.png');
  await expect(screen.getByRole('button', '次の画像')).toHaveCount(0);
  expect(
    await browser.evaluate(async () => {
      const image = document.querySelector<HTMLImageElement>('.article-image-previews img')!;
      await image.decode();
      image.scrollIntoView({ block: 'center' });
      const summary = document.querySelector('.article-summary')!.getBoundingClientRect();
      const bounds = image.closest('.stock-image-slide')!.getBoundingClientRect();
      return (
        image.naturalWidth > 0 &&
        Math.abs(bounds.width - Math.min(summary.width, 320)) < 1 &&
        Math.abs(bounds.left + bounds.right - summary.left - summary.right) < 1 &&
        bounds.top >= summary.bottom &&
        getComputedStyle(image).objectFit === 'contain'
      );
    }),
  ).toBe(true);
  await app.screenshot('stock-previews-light');
  await browser.emulateMedia({ colorScheme: 'dark' });
  await app.screenshot('stock-previews-dark');
  await browser.emulateMedia({ colorScheme: 'light' });
  // タイトルと同じ詳細導線がサムネイルの上でも使える。
  const previewCenter = await browser.evaluate(() => {
    const image = document.querySelector('.article-image-previews img')!;
    image.scrollIntoView({ block: 'center' });
    const bounds = image.getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  });
  await browser.mouse.move(previewCenter.x, previewCenter.y);
  await browser.mouse.down();
  await browser.mouse.up();
  expect(await browser.evaluate(() => window.location.hash.startsWith('#stock/'))).toBe(true);
  expect(
    await browser.evaluate(() =>
      [...document.querySelectorAll('.breadcrumb a')].map((link) => link.textContent?.trim()),
    ),
  ).toEqual(['トップ', fixture.projectName, 'ストック', '詳細']);
  await expect(screen.getByRole('dialog')).toHaveCount(0);
  await app.screenshot('stock-detail-light');
  await browser.emulateMedia({ colorScheme: 'dark' });
  await app.screenshot('stock-detail-dark');
  await browser.emulateMedia({ colorScheme: 'light' });
  await expect(browser.locator('.detail-summary .stock-image-carousel img')).toHaveAttribute(
    'alt',
    'stock-image.png',
  );
  await expect(screen.getByRole('button', '次の画像')).toHaveCount(0);
  await screen.getByRole('button', '入力した本文').click();
  await expect(browser.locator('.article-body')).toContainText(sourceText);
  const data = (await fixture.request(`/stocks?project_id=${fixture.projectId}`)) as {
    stocks: { project_id: string; title: string; id: string }[];
  };
  expect(data.stocks).toHaveLength(1);
  expect(data.stocks[0].project_id).toBe(fixture.projectId);
  const editContent = screen.getByRole('button', '本文を編集');
  const contentInput = screen.getByLabel('本文', { exact: true });
  await editContent.click();
  await expect(contentInput).toHaveValue(sourceText);
  await contentInput.fill('保存しない本文');
  await screen.getByRole('button', 'キャンセル', { exact: true }).click();
  await expect(browser.locator('.article-body')).toContainText(sourceText);

  let failFirstEdit = true;
  await browser.route('**/api/v1/stocks/*/content', async (route) => {
    if (route.request.method === 'PATCH' && failFirstEdit) {
      failFirstEdit = false;
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'E2E一時的な本文保存失敗' }),
      });
    }
    await route.continue();
  });
  await editContent.click();
  const revisedText = 'E2Eで本文を編集しました。\n編集後の内容を再読み込みして確認します。';
  await contentInput.fill(revisedText);
  const saveContent = screen.getByRole('button', '保存', { exact: true });
  await saveContent.click();
  await expect(screen.getByText('E2E一時的な本文保存失敗', { exact: true })).toBeVisible();
  await expect(contentInput).toHaveValue(revisedText);
  await saveContent.click();
  await expect(browser.locator('.article-body')).toContainText(revisedText);
  await screen.getByRole('button', '要約', { exact: true }).click();
  await expect(browser.locator('.detail-summary')).toContainText('E2Eで本文を編集しました。', {
    timeout: 15000,
  });
  await browser.reload();
  await screen.getByRole('button', '入力した本文').click();
  await expect(browser.locator('.article-body')).toHaveText(revisedText);

  await screen.getByRole('button', '画像', { exact: true }).click();
  await expect(browser.locator('.stock-image-list img')).toHaveAttribute('alt', 'stock-image.png');
  await browser
    .locator('.stock-images input[type="file"]')
    .setInputFiles(
      fileURLToPath(new URL('../../../tests/fixtures/detail-image.png', import.meta.url)),
    );
  const attachment = browser.locator('.stock-image-list img[alt="detail-image.png"]');
  await expect(attachment).toHaveAttribute('alt', 'detail-image.png');
  expect(
    await browser.evaluate(async () => {
      const image = document.querySelector<HTMLImageElement>(
        '.stock-image-list img[alt="detail-image.png"]',
      );
      await image?.decode();
      return Boolean(image?.complete && image.naturalWidth > 0);
    }),
  ).toBe(true);
  const detailHash = await browser.evaluate(() => window.location.hash);
  const enlargedImage = screen.getByRole('dialog', 'detail-image.png', { exact: true });
  const enlarge = screen.getByRole('button', '画像を拡大表示：detail-image.png', { exact: true });
  await enlarge.click();
  await expect(enlargedImage).toBeVisible();
  await expect(browser.locator('dialog[open] img')).toHaveAttribute('alt', 'detail-image.png');
  await screen.getByRole('button', '閉じる', { exact: true }).click();
  await expect(enlargedImage).toBeHidden();
  expect(await browser.evaluate(() => window.location.hash)).toBe(detailHash);
  await screen.getByRole('button', '要約', { exact: true }).click();
  await expect(browser.locator('.stock-image-position')).toHaveText('1 / 2');
  await screen.getByRole('button', '次の画像').click();
  await expect(browser.locator('.stock-image-carousel img')).toHaveAttribute(
    'alt',
    'detail-image.png',
  );
  await enlarge.click();
  await expect(enlargedImage).toBeVisible();
  const viewport = await browser.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const imageFits = () =>
    browser.evaluate(async () => {
      const thumbnail = document.querySelector<HTMLImageElement>('.stock-image-slide img')!;
      const image = document.querySelector<HTMLImageElement>('dialog[open] img')!;
      await image.decode();
      const bounds = image.getBoundingClientRect();
      return (
        image.src === thumbnail.src &&
        getComputedStyle(image).objectFit === 'contain' &&
        bounds.height > thumbnail.getBoundingClientRect().height &&
        bounds.left >= 0 &&
        bounds.top >= 0 &&
        bounds.right <= innerWidth &&
        bounds.bottom <= innerHeight
      );
    });
  expect(await imageFits()).toBe(true);
  await browser.setViewport({ width: 568, height: 320 });
  expect(await imageFits()).toBe(true);
  await browser.setViewport(viewport);
  await browser.keyboard.press('ArrowLeft');
  await expect(browser.locator('dialog[open] img')).toHaveAttribute('alt', 'detail-image.png');
  await browser.keyboard.press('Escape');
  await expect(enlargedImage).toBeHidden();
  expect(await browser.evaluate(() => window.location.hash)).toBe(detailHash);
  expect(
    await browser.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null),
  ).toBe('画像を拡大表示：detail-image.png');
  await expect(browser.locator('.stock-image-position')).toHaveText('2 / 2');
  await screen.getByRole('button', '前の画像').click();
  await expect(browser.locator('.stock-image-carousel img')).toHaveAttribute(
    'alt',
    'stock-image.png',
  );
  await browser.reload();
  await expect(browser.locator('.stock-detail-page')).toBeVisible();
  await screen.getByRole('button', '画像', { exact: true }).click();
  await expect(attachment).toHaveAttribute('alt', 'detail-image.png');
  const images = (await fixture.request(`/stocks/${data.stocks[0].id}/images`)) as {
    images: { id: string }[];
  };
  expect(images.images).toHaveLength(2);
  await app.open(`/#project/${fixture.projectId}`);
  await expect(previews).toHaveCount(1);
  await expect(previews).toHaveAttribute('alt', 'stock-image.png');
  await expect(previewPosition).toHaveText('1 / 2');
  const previewHeight = await browser.evaluate(
    () =>
      document.querySelector('.article-image-previews .stock-image-slide')!.getBoundingClientRect()
        .height,
  );
  await screen.getByRole('button', '次の画像').click();
  await expect(previewPosition).toHaveText('2 / 2');
  await expect(previews).toHaveAttribute('alt', 'detail-image.png');
  expect(
    await browser.evaluate(async () => {
      const image = document.querySelector<HTMLImageElement>('.article-image-previews img')!;
      await image.decode();
      return {
        portrait: image.naturalHeight > image.naturalWidth,
        fit: getComputedStyle(image).objectFit,
        height: image.closest('.stock-image-slide')!.getBoundingClientRect().height,
      };
    }),
  ).toEqual({ portrait: true, fit: 'contain', height: previewHeight });
  await browser.keyboard.press('ArrowLeft');
  await expect(previewPosition).toHaveText('1 / 2');
  const swipeHandled = await browser.evaluate(() => {
    const image = document.querySelector('.article-image-previews img')!;
    const touch = (clientX: number) =>
      new Touch({ identifier: 1, target: image, clientX, clientY: 80 });
    image.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch(160)] }));
    return !image.dispatchEvent(
      new TouchEvent('touchend', {
        bubbles: true,
        cancelable: true,
        changedTouches: [touch(30)],
      }),
    );
  });
  expect(swipeHandled).toBe(true);
  await expect(previewPosition).toHaveText('2 / 2');
  await expect(previews).toHaveAttribute('alt', 'detail-image.png');
  await screen.getByRole('button', '前の画像').click();
  await expect(previewPosition).toHaveText('1 / 2');
  await screen.getByRole('button', 'E2Eで保存した本文の詳細を開く', { exact: true }).click();
  await screen.getByRole('button', '画像', { exact: true }).click();
  const imageUrl = `${fixture.url}/api/v1/stocks/${data.stocks[0].id}/images/${images.images[0].id}`;
  expect((await fetch(imageUrl)).status).toBe(401);
  const dismiss = await browser.onDialog('dismiss');
  await screen.getByRole('button', '画像を削除：detail-image.png', { exact: true }).click();
  await expect(attachment).toHaveCount(1);
  await dismiss();
  const accept = await browser.onDialog('accept');
  await screen.getByRole('button', '画像を削除：detail-image.png', { exact: true }).click();
  await expect(attachment).toHaveCount(0);
  await accept();
  await browser.reload();
  await expect(browser.locator('.stock-detail-page')).toBeVisible();
  await screen.getByRole('button', '画像', { exact: true }).click();
  await expect(attachment).toHaveCount(0);
  await expect(browser.locator('.stock-image-list img')).toHaveAttribute('alt', 'stock-image.png');
  await screen.getByRole('button', '前の画面に戻る', { exact: true }).click();
  await expect(browser.locator('.stock-detail-page')).toHaveCount(0);
  expect(await browser.evaluate(() => window.location.hash)).toBe(`#project/${fixture.projectId}`);
  await expect(browser.locator('.article-card')).toBeVisible();
  await expect(previews).toHaveCount(1);
  await expect(previews).toHaveAttribute('alt', 'stock-image.png');
  await expect(previewPosition).toHaveCount(0);
  // MCPと同じ保存APIで本文採用したストックの表示を確認する。引数・権限・再送はVitestで検証。
  const verbatimText =
    '  原文の段落を保ちます。https://example.com/source?x=1&y=2\n\n' +
    '長い本文を省略せず採用します。'.repeat(100) +
    '\n  ';
  const verbatim = await fixture.request('/stocks', 'POST', {
    type: 'text',
    project_id: fixture.projectId,
    title: 'E2E要約しない本文',
    text: verbatimText,
    skip_summary: true,
  });
  await app.open(`/#project/${fixture.projectId}`);
  await expect(
    browser.locator('.article-card').filter({ hasText: 'E2E要約しない本文' }).getByRole('img'),
  ).toHaveCount(0);
  await screen.getByRole('heading', 'E2E要約しない本文', { exact: true }).click();
  await expect(browser.locator('.verbatim-content')).toHaveText(verbatimText);
  await expect(browser.locator('.verbatim-content a')).toHaveAttribute(
    'href',
    'https://example.com/source?x=1&y=2',
  );
  await expect(browser.locator('.verbatim-content a')).toHaveAttribute('target', '_blank');
  await browser.reload();
  await expect(browser.locator('.stock-detail-page')).toBeVisible();
  await expect(browser.locator('.verbatim-content')).toHaveText(verbatimText);
  await expect(browser.locator('.verbatim-content a')).toHaveAttribute(
    'href',
    'https://example.com/source?x=1&y=2',
  );
  expect(await fixture.request(`/stocks/${verbatim.id}`)).toMatchObject({
    stock: { summary: { overview: verbatimText, verbatim: true } },
  });
  const whiteSpace = await browser.evaluate(
    () => getComputedStyle(document.querySelector('.verbatim-content')!).whiteSpace,
  );
  expect(whiteSpace).toBe('pre-wrap');
  await expect(browser.locator('.stock-detail-page')).toBeVisible();
  await expect(screen.getByRole('dialog')).toHaveCount(0);
  await screen.getByRole('button', '入力した本文', { exact: true }).click();
  await expect(browser.locator('.article-body')).toHaveText(verbatimText);
  await expect(browser.locator('.article-body a')).toHaveAttribute(
    'href',
    'https://example.com/source?x=1&y=2',
  );
  await screen.getByRole('button', '前の画面に戻る', { exact: true }).click();
  await fixture.request('/questions', 'POST', {
    project_id: fixture.projectId,
    text: 'E2E少し小さくした問いの文字を確認します。',
  });
  await app.open('/#questions');
  await expect(
    screen.getByText('E2E少し小さくした問いの文字を確認します。', { exact: true }),
  ).toBeVisible();
  expect(
    await browser.evaluate(() => {
      const size = getComputedStyle(
        document.querySelector('.question-card .question-text')!,
      ).fontSize;
      return size === (window.innerWidth <= 760 ? '17px' : '16px');
    }),
  ).toBe(true);
  await app.screenshot('question-list-light');
  await browser.emulateMedia({ colorScheme: 'dark' });
  await app.screenshot('question-list-dark');
  await browser.emulateMedia({ colorScheme: 'light' });
});

test('PUFU-001 プ譜を編集保存し新局面と過去局面を保持して一覧へ戻る', async ({
  app,
  screen,
  browser,
  agent,
  fixture,
}) => {
  const score = JSON.parse(
    await readFile(new URL('../../../tests/fixtures/pufu-sparse.json', import.meta.url), 'utf8'),
  );
  score.gainingGoal.text = 'E2Eプ譜の目標';
  score.winCondition.comment.text = 'E2E利用者が書いたコメント';
  const { question } = (await fixture.request('/questions', 'POST', {
    project_id: fixture.projectId,
    text: 'E2Eプ譜の関連する問い',
  })) as { question: { id: string } };
  const stock = await fixture.request('/stocks', 'POST', {
    project_id: fixture.projectId,
    type: 'text',
    title: 'E2Eプ譜の関連するストック',
    text: 'プ譜の折りたたみ表示を確認するための本文です。',
  });
  const { question: secondQuestion } = (await fixture.request('/questions', 'POST', {
    project_id: fixture.projectId,
    text: 'E2E選び直す問い',
  })) as { question: { id: string } };
  const secondStock = await fixture.request('/stocks', 'POST', {
    project_id: fixture.projectId,
    type: 'text',
    title: 'E2E選び直すストック',
    text: '選択を切り替えるための別のストックです。',
  });
  await app.open('/#pufus');
  await screen.getByRole('button', 'プ譜を追加').click();
  await browser.locator('#pufu-project').selectOption({ value: fixture.projectId });
  await expect(screen.getByRole('button', 'プ譜を作成')).toBeDisabled();
  await screen.getByRole('checkbox', 'E2Eプ譜の関連する問い', { exact: true }).check();
  await screen.getByRole('checkbox', 'E2Eプ譜の関連するストック', { exact: true }).check();
  await screen.getByRole('checkbox', 'E2E選び直す問い', { exact: true }).check();
  await screen.getByRole('checkbox', 'E2E選び直すストック', { exact: true }).check();
  await expect(browser.locator('.relation-picker input[type="checkbox"]:checked')).toHaveCount(2);
  await screen.getByRole('checkbox', 'E2Eプ譜の関連する問い', { exact: true }).check();
  await screen.getByRole('checkbox', 'E2Eプ譜の関連するストック', { exact: true }).check();
  await expect(browser.locator('.relation-picker input[type="checkbox"]:checked')).toHaveCount(2);
  await expect(browser.locator('#pufu-task')).toHaveValue('');
  await expect(browser.locator('#pufu-details')).toHaveValue('');
  await screen.getByRole('button', 'プ譜を作成').click();
  await expect(screen.getByRole('button', '編集する')).toBeVisible();
  const generated = (await fixture.request('/pufus')) as {
    pufus: { id: string; task: string; question_ids: string[]; stock_ids: string[] }[];
  };
  expect(generated.pufus).toHaveLength(1);
  const inferred = generated.pufus[0];
  expect(inferred.task.length).toBeGreaterThan(0);
  expect(inferred.question_ids).toEqual([question.id]);
  expect(inferred.stock_ids).toEqual([stock.id]);
  await app.open(`/#pufu/${inferred.id}`);
  await expect(browser.locator('.pufu-context-task')).toContainText(inferred.task);
  expect(await fixture.request(`/pufus/${inferred.id}`)).toMatchObject({
    pufu: {
      task: inferred.task,
      score: {
        gainingGoal: { text: inferred.task, comment: { text: '' } },
        purposes: [{ measures: [] }],
        elements: {
          money: { text: '' },
          rival: { text: '' },
          foreignEnemy: { text: '' },
        },
      },
    },
  });
  // デモ生成は即時に終わるため、詳細レスポンスだけ差し替えてポーリング中の表示を確認する。
  const detail = (await fixture.request(`/pufus/${inferred.id}`)).pufu as Record<string, unknown>;
  const progressStates = {
    queued: null,
    retry: { stage: 'extract', attempt: 2, status: 'running' },
    review: { stage: 'review', attempt: 1, status: 'done' },
    repair: { stage: 'repair', attempt: 1, status: 'running' },
  };
  let state: keyof typeof progressStates | 'ready' = 'queued';
  await browser.route(`**/api/v1/pufus/${inferred.id}`, async (route) => {
    if (state === 'ready') return route.continue();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        pufu: {
          ...detail,
          status: state === 'queued' ? 'queued' : 'generating',
          generation_progress: progressStates[state],
          phases: [],
          score: null,
        },
      }),
    });
  });
  await browser.reload();
  const progress = browser.locator('.pufu-page').getByRole('status');
  const segments = browser.locator('.pufu-progress-steps span');
  const completedSegments = browser.locator('.pufu-progress-steps [data-state="complete"]');
  const currentSegments = browser.locator('.pufu-progress-steps [data-state="current"]');
  const pendingSegments = browser.locator('.pufu-progress-steps [data-state="pending"]');
  await expect(progress).toContainText('生成待ち');
  await expect(segments).toHaveCount(0);
  state = 'retry';
  await expect(progress).toContainText('資料から事実を抽出');
  await expect(progress).toContainText('通常4ステップのうち1ステップ目');
  await expect(progress).toContainText('自動で再試行しています（2回目）');
  await expect(currentSegments).toHaveCount(1);
  await expect(pendingSegments).toHaveCount(3);
  const segmentHeights = await browser.evaluate(() =>
    Array.from(
      document.querySelectorAll('.pufu-progress-steps span'),
      (segment) => segment.getBoundingClientRect().height,
    ),
  );
  expect(segmentHeights[0]).toBeGreaterThan(0);
  expect(new Set(segmentHeights).size).toBe(1);
  await browser.reload();
  await expect(progress).toContainText('自動で再試行しています（2回目）');
  await expect(progress).toContainText('通常4ステップのうち1ステップ目');
  state = 'review';
  await expect(progress).toContainText('勝利条件を検証');
  await expect(progress).toContainText('通常4ステップのうち4ステップ目');
  await expect(completedSegments).toHaveCount(4);
  state = 'repair';
  await expect(progress).toContainText('勝利条件を修正');
  await expect(progress).toContainText('全6ステップのうち5ステップ目');
  await expect(segments).toHaveCount(6);
  await expect(completedSegments).toHaveCount(4);
  await expect(currentSegments).toHaveCount(1);
  await expect(pendingSegments).toHaveCount(1);
  state = 'ready';
  await expect(screen.getByRole('button', '編集する')).toBeVisible();
  await fixture.request(`/pufus/${inferred.id}`, 'DELETE');
  const { pufu } = (await fixture.request('/pufus', 'POST', {
    project_id: fixture.projectId,
    request_id: requestId(),
    question_ids: [question.id, secondQuestion.id],
    stock_ids: [stock.id, secondStock.id],
    score,
  })) as { pufu: { id: string } };
  await fixture.request(`/pufus/${pufu.id}/relations`, 'PATCH', {
    revision: 1,
    question_ids: [question.id, secondQuestion.id],
    stock_ids: [stock.id, secondStock.id],
  });
  await app.open('/#pufus');
  await screen.getByRole('button', /E2Eプ譜の目標/).click();
  await expect(screen.getByRole('button', '編集する')).toBeVisible();
  const stocksToggle = browser.locator('.pufu-related-stocks > summary');
  const questionsToggle = browser.locator('.pufu-related-questions > summary');
  const stockList = browser.locator('.pufu-related-stocks ul');
  const questionLink = browser
    .locator('.pufu-related-questions')
    .getByRole('button', 'E2Eプ譜の関連する問い');
  await expect(stockList).toBeHidden();
  await expect(questionLink).toBeHidden();
  await stocksToggle.click();
  await expect(stockList).toBeVisible();
  await expect(stockList).toContainText('E2Eプ譜の関連するストック');
  await expect(stockList).toContainText('E2E選び直すストック');
  await expect(questionLink).toBeHidden();
  await questionsToggle.click();
  await expect(questionLink).toBeVisible();
  await expect(
    browser.locator('.pufu-related-questions').getByRole('button', 'E2E選び直す問い'),
  ).toBeVisible();
  await stocksToggle.click();
  await expect(stockList).toBeHidden();
  await expect(questionLink).toBeVisible();
  await questionsToggle.click();
  await expect(questionLink).toBeHidden();
  await agent.act(goals.editor);
  await expect(screen.getByRole('dialog', '第1局面のプ譜を編集')).toBeVisible();
  await browser
    .locator('.pufu-editor-root')
    .getByText('E2Eプ譜の目標')
    .fill('E2Eプ譜の編集済み目標');
  await screen.getByRole('button', '保存').click();
  await expect(
    screen.getByRole('status').filter({ hasText: 'プ譜を保存しました。' }),
  ).toBeVisible();
  await expect(browser.locator('.pufu-title-row h2')).toHaveText('E2Eプ譜の編集済み目標');
  await screen.getByRole('button', '閉じる').click();
  await app.open(`/#pufu/${pufu.id}`);
  await screen.getByRole('button', '局面を追加').click();
  await expect(browser.locator('.pufu-phase-number')).toHaveText('第2局面');
  await screen.getByRole('button', '編集する').click();
  await expect(screen.getByRole('dialog', '第2局面のプ譜を編集')).toBeVisible();
  await browser
    .locator('.pufu-editor-root')
    .getByText('E2Eプ譜の編集済み目標')
    .fill('E2Eプ譜の次局面の目標');
  await screen.getByRole('button', '保存').click();
  await expect(
    screen.getByRole('status').filter({ hasText: 'プ譜を保存しました。' }),
  ).toBeVisible();
  await screen.getByRole('button', '閉じる').click();
  await expect(browser.locator('.pufu-context-task')).toContainText('E2Eプ譜の次局面の目標');
  await app.open(`/#pufu/${pufu.id}`);
  await expect(browser.locator('.pufu-phase-number')).toHaveText('第2局面');
  const savedRelations = (await fixture.request(`/pufus/${pufu.id}`)) as {
    pufu: { question_ids: string[]; stock_ids: string[] };
  };
  expect(savedRelations.pufu.question_ids).toHaveLength(2);
  expect(savedRelations.pufu.stock_ids).toHaveLength(2);
  await screen.getByRole('button', '前の局面へ').click();
  await expect(browser.locator('.pufu-phase-number')).toHaveText('第1局面');
  // 詳細を開いた後のデプロイで、この画面が参照する古いJSが配信されなくなる状況を再現する。
  const scripts = /\/assets\/[^/?]+\.js(?:\?|$)/;
  await browser.route(scripts, (route) => route.fulfill({ status: 404 }));
  await screen.getByRole('button', 'ダウンロード', { exact: true }).click();
  const png = await browser.waitForDownload(
    () => screen.getByRole('button', '画像（PNG）').click(),
    { timeout: 10000 },
  );
  expect(png.suggestedFilename).toBe(`${pufu.id}-phase-1.png`);
  expect((await readFile(png.absolutePath)).subarray(0, 8).toString('hex')).toBe(
    '89504e470d0a1a0a',
  );
  await browser.unroute(scripts);
  const saved = (await fixture.request(`/pufus/${pufu.id}`)) as {
    pufu: {
      current_phase: number;
      phases: {
        number: number;
        score: { gainingGoal: { text: string }; winCondition: { comment: { text: string } } };
      }[];
    };
  };
  expect(saved.pufu.current_phase).toBe(2);
  expect(saved.pufu.phases.map((phase) => phase.score.winCondition.comment.text)).toEqual([
    'E2E利用者が書いたコメント',
    'E2E利用者が書いたコメント',
  ]);
  expect(saved.pufu.phases.map(({ score }) => score.gainingGoal.text)).toEqual([
    'E2Eプ譜の編集済み目標',
    'E2Eプ譜の次局面の目標',
  ]);
  await app.open('/#pufus');
  await expect(screen.getByRole('button', 'タイトルを編集')).toHaveCount(0);
  await screen.getByRole('button', /E2Eプ譜の編集済み目標/).click();
  await screen.getByRole('button', 'タイトルを編集').click();
  await screen.getByLabel('タイトル任意').fill('E2E短いタイトル');
  await screen.getByRole('button', '保存', { exact: true }).click();
  await expect(screen.getByRole('heading', 'E2E短いタイトル')).toBeVisible();
  await app.open('/#pufus');
  await screen.getByRole('button', /E2E短いタイトル/).click();
  await expect(screen.getByRole('heading', 'E2E短いタイトル')).toBeVisible();
  await screen.getByRole('button', 'タイトルを編集').click();
  await screen.getByLabel('タイトル任意').fill('');
  await screen.getByRole('button', '保存', { exact: true }).click();
  await expect(browser.locator('.pufu-title-row h2')).toHaveText('E2Eプ譜の編集済み目標');
  await app.open('/#pufus');
  await screen.getByRole('button', /E2Eプ譜の編集済み目標/).click();
  await screen.getByRole('button', 'プ譜の一覧に戻る').click();
  await expect(screen.getByRole('heading', 'すべてのプ譜')).toBeVisible();
  await screen.getByRole('button', /E2Eプ譜の編集済み目標/).click();
  await expect(screen.getByRole('button', 'プ譜を削除')).toBeHidden();
  await browser.locator('.delete-action summary').click();
  await screen.getByRole('button', 'プ譜を削除').click();
  await expect(screen.getByRole('dialog', 'このプ譜を削除しますか？')).toContainText(
    'E2Eプ譜の次局面の目標',
  );
  await screen.getByRole('button', 'キャンセル').click();
  expect((await fixture.request(`/pufus/${pufu.id}`)).pufu).toBeDefined();
  await screen.getByRole('button', 'プ譜を削除').click();
  await browser.locator('.delete-confirmation').getByRole('button', 'プ譜を削除').click();
  await expect(screen.getByRole('heading', 'すべてのプ譜')).toBeVisible();
  await expect(
    screen.getByRole('status').filter({ hasText: 'プ譜を削除しました。' }),
  ).toBeVisible();
  await expect(screen.getByRole('button', /E2Eプ譜の編集済み目標/)).toHaveCount(0);
  await app.open('/#pufus');
  await expect(screen.getByRole('button', /E2Eプ譜の編集済み目標/)).toHaveCount(0);
  expect(await fixture.request('/pufus')).toMatchObject({ total: 0, pufus: [] });
});

test('PUBLIC-001 公開前に確認し匿名で閲覧でき非公開化後は取得できない', async ({
  app,
  screen,
  browser,
  agent,
  fixture,
}) => {
  await app.open(`/#settings/${fixture.projectId}`);
  await screen.getByRole('switch', 'プロジェクトを公開する').check();
  await screen.getByRole('button', '公開設定を保存').click();
  await expect(screen.getByRole('dialog', '公開前のご確認')).toBeVisible();
  await expect(screen.getByRole('button', 'OK')).toBeDisabled();
  const before = (await fixture.request(`/projects/${fixture.projectId}/publication`)) as {
    publication: { public_id: string | null; is_public: boolean; search_indexable: boolean };
  };
  expect(before.publication.is_public).toBe(false);
  await expect(browser.locator('.publication-views')).toHaveCount(0);
  expect(before.publication.search_indexable).toBe(false);
  await agent.act(goals.publish);
  await expect(screen.getByRole('dialog', '公開前のご確認')).toBeHidden();
  const published = (await fixture.request(`/projects/${fixture.projectId}/publication`)) as {
    publication: { public_id: string; is_public: boolean };
  };
  expect(published.publication.is_public).toBe(true);
  const summary = browser.locator('.project-settings > .publication-settings + .publication-views');
  await expect(
    browser.locator('.publication-settings + .publication-views dl .public-view-count'),
  ).toHaveCount(4);
  await expect(summary).toBeVisible();
  await expect(screen.getByRole('heading', '詳細ページの閲覧数 上位5件')).toHaveCount(0);
  const publicId = published.publication.public_id;
  const beforeIndexing = await fetch(`${fixture.url}/p/${publicId}`);
  expect(beforeIndexing.headers.get('X-Robots-Tag')).toBe('noindex, follow');
  await screen.getByLabel('検索エンジンへの掲載を許可する').check();
  await screen.getByRole('button', '公開設定を保存').click();
  for (let i = 0; i < 3; i++)
    await browser.locator('.publication-confirmation input[type="checkbox"]').nth(i).check();
  await screen.getByRole('button', 'OK').click();
  await expect(screen.getByRole('dialog', '公開前のご確認')).toBeHidden();
  const { question } = (await fixture.request('/questions', 'POST', {
    project_id: fixture.projectId,
    text: 'E2Eの公開する問い',
  })) as { question: { id: string } };
  const score = JSON.parse(
    await readFile(new URL('../../../tests/fixtures/pufu-sparse.json', import.meta.url), 'utf8'),
  );
  score.gainingGoal.text = 'E2Eの公開プ譜';
  score.purposes[0].measures[0].progress = 50;
  const { pufu } = (await fixture.request('/pufus', 'POST', {
    project_id: fixture.projectId,
    question_id: question.id,
    title: 'E2Eの公開プ譜タイトル',
    request_id: requestId(),
    score,
  })) as { pufu: { id: string } };
  const verbatimText =
    '  公開とログイン後の画面で原文を表示します。https://example.com/public?x=1&y=2\n\n' +
    '長い本文の空白と改行を保持します。'.repeat(100) +
    '\n  原文の末尾。\n  ';
  const stock = await fixture.request('/stocks', 'POST', {
    project_id: fixture.projectId,
    type: 'text',
    title: 'E2Eの公開するストック',
    text: verbatimText,
    skip_summary: true,
    note: 'E2E_PRIVATE_NOTE',
  });
  await fixture.request(`/questions/${question.id}`, 'PATCH', { stock_ids: [stock.id] });
  const publicImageUrls: string[] = [];
  for (const filename of ['stock-image.png', 'detail-image.png']) {
    const response = await fetch(`${fixture.url}/api/v1/stocks/${stock.id}/images`, {
      method: 'POST',
      headers: {
        Cookie: fixture.cookie,
        Origin: fixture.url,
        'Content-Type': 'image/png',
        'X-File-Name': filename,
      },
      body: await readFile(new URL(`../../../tests/fixtures/${filename}`, import.meta.url)),
    });
    expect(response.status).toBe(201);
    const { image } = (await response.json()) as { image: { id: string } };
    publicImageUrls.push(
      `${fixture.url}/api/public/projects/${publicId}/stocks/${stock.id}/images/${image.id}`,
    );
  }
  const [publicImageUrl, secondPublicImageUrl] = publicImageUrls;
  await fixture.request(`/pufus/${pufu.id}/relations`, 'PATCH', {
    revision: 1,
    question_ids: [question.id],
    stock_ids: [stock.id],
  });
  const nextScore = structuredClone(score);
  nextScore.gainingGoal.text = 'E2Eの公開プ譜・次の局面';
  await fixture.request(`/pufus/${pufu.id}/phases`, 'POST', {
    revision: 2,
    phase: 1,
    score,
  });
  await fixture.request(`/pufus/${pufu.id}`, 'PATCH', {
    revision: 3,
    phase: 2,
    score: nextScore,
  });
  expect((await fetch(`${fixture.url}/api/public/projects/${publicId}`)).status).toBe(200);
  const initialHtml = await fetch(`${fixture.url}/p/${publicId}/pufus/${pufu.id}`);
  expect(initialHtml.status).toBe(200);
  expect(initialHtml.headers.get('Cache-Control')).toBe('no-store');
  expect(initialHtml.headers.get('X-Robots-Tag')).toBe('index, follow');
  const publicHtml = await initialHtml.text();
  expect(publicHtml).toContain('E2Eの公開プ譜・次の局面');
  const ogImage = await browser.evaluate(
    (html) =>
      new DOMParser()
        .parseFromString(html, 'text/html')
        .querySelector('meta[property="og:image"]')
        ?.getAttribute('content') ?? null,
    publicHtml,
  );
  const logo = await readFile(new URL('../../../public/pufu-lens-logo.jpg', import.meta.url));
  const logoVersion = createHash('sha256').update(logo).digest('hex').slice(0, 16);
  const logoUrl = `${fixture.url}/pufu-lens-logo.jpg?v=${logoVersion}`;
  expect(ogImage).toBe(logoUrl);
  const logoResponse = await fetch(logoUrl);
  expect(logoResponse.status).toBe(200);
  expect(logoResponse.headers.get('Content-Type')).toContain('image/jpeg');
  expect(Buffer.from(await logoResponse.arrayBuffer()).equals(logo)).toBe(true);
  expect(await (await fetch(`${fixture.url}/sitemaps/${publicId}/pufus-1.xml`)).text()).toContain(
    `/p/${publicId}/pufus/${pufu.id}`,
  );
  await app.open(`/#project/${fixture.projectId}`);
  await expect(screen.getByRole('heading', 'E2Eの公開するストック', { exact: true })).toBeVisible();
  const stockTypography = await browser.evaluate(() => {
    const title = getComputedStyle(document.querySelector('.article-title')!);
    const summary = getComputedStyle(document.querySelector('.article-summary')!);
    return {
      title: [title.fontSize, title.fontWeight, title.lineHeight],
      summary: [summary.fontSize, summary.lineHeight, summary.whiteSpace, summary.webkitLineClamp],
    };
  });
  await app.open('/#questions');
  await expect(screen.getByText('E2Eの公開する問い', { exact: true })).toBeVisible();
  const questionTypography = await browser.evaluate(() => {
    const title = getComputedStyle(document.querySelector('.question-card .question-text')!);
    return [title.fontSize, title.fontWeight, title.lineHeight];
  });
  await app.open(`/#project/${fixture.projectId}`);
  await screen.getByRole('heading', 'E2Eの公開するストック', { exact: true }).click();
  await expect(browser.locator('.verbatim-content')).toHaveText(verbatimText);
  const cookies = await browser.cookies();
  await app.clearState();
  await app.open('/');
  await expect(
    browser.locator(`.public-project-card[href="/p/${publicId}"] .public-card-footer`),
  ).toContainText('1 プ譜');
  await expect(
    browser.locator(`.public-project-card[href="/p/${publicId}"] .public-view-count`),
  ).toHaveText('0');
  await app.open(`/p/${publicId}`);
  await expect(screen.getByRole('heading', fixture.projectName)).toBeVisible();
  await expect(browser.locator('.public-stock-card .public-view-count')).toHaveText('0');
  await expect(browser.locator('.public-stock-card .public-summary')).toHaveText(verbatimText);
  await expect(
    browser.locator('.public-stock-card .public-card-footer .public-view-count'),
  ).toHaveText('0');
  await expect(browser.locator('.public-stock-card .public-card-footer a')).toHaveCount(0);
  const preview = '.public-stock-card .public-summary + .article-image-previews';
  const previewImage = browser.locator(`${preview} img`);
  const previewPosition = browser.locator(`${preview} .stock-image-position`);
  await expect(previewImage).toHaveAttribute('src', new URL(publicImageUrl).pathname);
  await expect(previewPosition).toHaveText('1 / 2');
  await screen.getByRole('button', '次の画像', { exact: true }).click();
  await expect(previewPosition).toHaveText('2 / 2');
  await expect(previewImage).toHaveAttribute('src', new URL(secondPublicImageUrl).pathname);
  expect(
    await browser.evaluate(async () => {
      const image = document.querySelector<HTMLImageElement>('.article-image-previews img')!;
      await image.decode();
      return image.naturalWidth > 0 && image.getBoundingClientRect().width <= 320;
    }),
  ).toBe(true);
  await screen.getByRole('button', '前の画像', { exact: true }).click();
  await expect(previewPosition).toHaveText('1 / 2');
  expect(
    await browser.evaluate(() => {
      const title = getComputedStyle(document.querySelector('.public-stock-card h3')!);
      const element = document.querySelector<HTMLElement>('.public-stock-card .public-summary')!;
      const summary = getComputedStyle(element);
      return {
        title: [title.fontSize, title.fontWeight, title.lineHeight],
        summary: [
          summary.fontSize,
          summary.lineHeight,
          summary.whiteSpace,
          summary.webkitLineClamp,
        ],
        visibleLines: Math.round(element.clientHeight / parseFloat(summary.lineHeight)),
        fitsViewport: document.documentElement.scrollWidth <= window.innerWidth,
      };
    }),
  ).toEqual({ ...stockTypography, visibleLines: 3, fitsViewport: true });
  await app.screenshot('public-stock-cards-light');
  await browser.emulateMedia({ colorScheme: 'dark' });
  await expect(browser.locator('html')).toHaveAttribute('data-theme', 'dark');
  await app.screenshot('public-stock-cards-dark');
  await browser.emulateMedia({ colorScheme: 'light' });
  await expect(browser.locator('html')).toHaveAttribute('data-theme', 'light');
  await browser.locator(`${preview} a`).click();
  await expect(browser.locator('.public-stock-detail .public-summary')).toHaveText(verbatimText);
  await expect(screen.getByRole('img', '閲覧 0 回', { exact: true }).first()).toBeVisible();
  await app.open(`/p/${publicId}`);
  await browser.locator('.public-tabs a').filter({ hasText: '問い・気づき' }).click();
  await expect(screen.getByRole('heading', 'E2Eの公開する問い', { exact: true })).toBeVisible();
  await expect(screen.getByText('問い・気づきの詳細を見る', { exact: true })).toHaveCount(0);
  expect(
    await browser.evaluate(() => {
      const title = getComputedStyle(document.querySelector('.public-question-card h3')!);
      return [title.fontSize, title.fontWeight, title.lineHeight];
    }),
  ).toEqual(questionTypography);
  await app.screenshot('public-question-cards-light');
  await browser.emulateMedia({ colorScheme: 'dark' });
  await expect(browser.locator('html')).toHaveAttribute('data-theme', 'dark');
  await app.screenshot('public-question-cards-dark');
  await browser.emulateMedia({ colorScheme: 'light' });
  await expect(browser.locator('html')).toHaveAttribute('data-theme', 'light');
  await browser.locator('.public-question-card').filter({ hasText: 'E2Eの公開する問い' }).click();
  await expect(browser.locator('.public-stock-card .public-summary')).toHaveText(verbatimText);
  await expect(previewImage).toHaveAttribute('src', new URL(publicImageUrl).pathname);
  await expect(browser.locator('.public-stock-detail,.public-stock-points')).toHaveCount(0);
  await expect(screen.getByText('ストックの詳細を見る', { exact: true })).toHaveCount(0);
  expect(
    await browser.evaluate(() => {
      const card = document.querySelector('.public-stock-card')!;
      card.scrollIntoView({ block: 'center' });
      const summary = card.querySelector<HTMLElement>('.public-summary')!;
      const style = getComputedStyle(summary);
      return {
        clamp: style.webkitLineClamp,
        visibleLines: Math.round(summary.clientHeight / parseFloat(style.lineHeight)),
        fitsViewport: document.documentElement.scrollWidth <= window.innerWidth,
      };
    }),
  ).toEqual({ clamp: '3', visibleLines: 3, fitsViewport: true });
  await app.screenshot('public-question-stock-preview-light');
  await browser.emulateMedia({ colorScheme: 'dark' });
  await expect(browser.locator('html')).toHaveAttribute('data-theme', 'dark');
  await app.screenshot('public-question-stock-preview-dark');
  await browser.emulateMedia({ colorScheme: 'light' });
  await expect(browser.locator('html')).toHaveAttribute('data-theme', 'light');
  const summaryCenter = await browser.evaluate(() => {
    const summary = document.querySelector('.public-stock-card .public-summary')!;
    summary.scrollIntoView({ block: 'center' });
    const { x, y, width, height } = summary.getBoundingClientRect();
    return { x: x + width / 2, y: y + height / 2 };
  });
  await browser.mouse.move(summaryCenter.x, summaryCenter.y);
  await browser.mouse.down();
  await browser.mouse.up();
  await expect(browser.locator('.public-stock-detail .public-summary')).toHaveText(verbatimText);
  await expect(browser.locator('.public-stock-detail .public-summary a')).toHaveAttribute(
    'href',
    'https://example.com/public?x=1&y=2',
  );
  await expect(browser.locator('.public-stock-detail .public-summary a')).toHaveAttribute(
    'target',
    '_blank',
  );
  await expect(browser.locator('.public-stock-points')).toHaveCount(0);
  await expect(browser.locator('.public-stock-detail .stock-image-carousel img')).toHaveAttribute(
    'alt',
    'stock-image.png',
  );
  await expect(browser.locator('.public-stock-detail .stock-image-caption')).toBeHidden();
  await screen.getByRole('button', '画像を拡大表示：stock-image.png', { exact: true }).click();
  const enlargedStock = screen.getByRole('dialog', 'stock-image.png', { exact: true });
  await expect(enlargedStock).toBeVisible();
  await expect(browser.locator('dialog[open] img')).toHaveAttribute(
    'src',
    new URL(publicImageUrl).pathname,
  );
  await screen.getByRole('button', '閉じる', { exact: true }).click();
  await expect(enlargedStock).toBeHidden();
  await app.screenshot('public-stock-detail-light');
  await browser.emulateMedia({ colorScheme: 'dark' });
  await expect(browser.locator('html')).toHaveAttribute('data-theme', 'dark');
  await app.screenshot('public-stock-detail-dark');
  await browser.emulateMedia({ colorScheme: 'light' });
  await expect(browser.locator('html')).toHaveAttribute('data-theme', 'light');
  expect((await fetch(publicImageUrl)).status).toBe(200);
  await browser.reload();
  await expect(browser.locator('.public-stock-detail .public-summary')).toHaveText(verbatimText);
  await expect(browser.locator('.public-stock-detail .public-summary a')).toHaveAttribute(
    'href',
    'https://example.com/public?x=1&y=2',
  );
  await expect(screen.getByText('要約はまだありません。', { exact: true })).toHaveCount(0);
  const whiteSpace = await browser.evaluate(
    () =>
      getComputedStyle(document.querySelector('.public-stock-detail .public-summary')!).whiteSpace,
  );
  expect(whiteSpace).toBe('pre-wrap');
  const publicStock = await fetch(
    `${fixture.url}/api/public/projects/${publicId}/stocks/${stock.id}`,
  );
  const publicStockJson = await publicStock.json();
  expect(publicStockJson).toMatchObject({
    stock: { summary: { overview: verbatimText, verbatim: true } },
  });
  expect(JSON.stringify(publicStockJson)).not.toContain('E2E_PRIVATE_NOTE');
  await app.open(`/p/${publicId}`);
  await browser.locator('.public-tabs a').filter({ hasText: 'プ譜' }).click();
  await expect(browser.locator('.public-pufu-card h3')).toHaveText('E2Eの公開プ譜タイトル');
  await expect(browser.locator('.public-pufu-card .public-pufu-goal')).toHaveText(
    'E2Eの公開プ譜・次の局面',
  );
  await expect(browser.locator('.public-pufu-card .public-view-count')).toHaveText('0');
  await expect(screen.getByRole('link', /E2Eの公開プ譜/)).toBeVisible();
  await screen.getByRole('link', /E2Eの公開プ譜/).click();
  await expect(browser.locator('section[aria-label="課題"]')).toContainText('E2Eの公開プ譜');
  const stockList = browser.locator('.pufu-related-stocks ul');
  const questionList = browser.locator('.pufu-related-questions ul');
  await expect(stockList).toBeHidden();
  await expect(questionList).toBeHidden();
  await browser.locator('.pufu-related-stocks > summary').click();
  await expect(stockList).toBeVisible();
  await expect(stockList).toContainText('E2Eの公開するストック');
  await expect(questionList).toBeHidden();
  await browser.locator('.pufu-related-questions > summary').click();
  await expect(questionList).toBeVisible();
  await expect(questionList).toContainText('E2Eの公開する問い');
  await browser.locator('.pufu-related-stocks > summary').click();
  await expect(stockList).toBeHidden();
  await expect(questionList).toBeVisible();
  await browser.locator('.pufu-related-questions > summary').click();
  await expect(questionList).toBeHidden();
  await expect(browser.locator('.pufu-phase-number')).toHaveText('第2局面');
  await expect(screen.getByRole('button', '次の局面へ')).toHaveCount(0);
  await expect(screen.getByRole('img', '第2局面のプ譜')).toContainText('E2Eの公開プ譜・次の局面');
  await expect(browser.locator('.public-pufu-text')).toContainText('E2Eの公開プ譜・次の局面');
  await screen.getByRole('button', '前の局面へ').click();
  await expect(browser.locator('.pufu-phase-number')).toHaveText('第1局面');
  await expect(screen.getByRole('button', '前の局面へ')).toHaveCount(0);
  await expect(browser.locator('.public-pufu-text')).not.toContainText('E2Eの公開プ譜・次の局面');
  await expect(screen.getByRole('img', '第1局面のプ譜')).toBeVisible();
  await screen.getByRole('button', '第1局面のプ譜を拡大表示').click();
  await expect(screen.getByRole('dialog', '第1局面のプ譜')).toBeVisible();
  await screen.getByRole('button', '閉じる').click();
  await expect(browser.locator('[aria-label="プ譜（閲覧のみ）"] textarea')).toHaveCount(0);
  await expect(screen.getByRole('img', '第1局面のプ譜')).not.toContainText('50%');
  await screen.getByRole('button', '次の局面へ').click();
  await expect(browser.locator('.pufu-phase-number')).toHaveText('第2局面');
  await expect(screen.getByRole('img', '第2局面のプ譜')).toContainText('E2Eの公開プ譜・次の局面');
  await expect(browser.locator('.public-pufu-text')).toContainText('E2Eの公開プ譜・次の局面');
  await screen.getByRole('link', 'プ譜の一覧に戻る').click();
  await expect(screen.getByRole('link', /E2Eの公開プ譜/)).toBeVisible();
  await browser.setCookies(cookies);
  for (let index = 1; index <= publicListPageSize; index++) {
    await fixture.request('/questions', 'POST', {
      project_id: fixture.projectId,
      text: `E2Eのページ送り用の問い ${index}`,
    });
  }
  await app.open(`/#settings/${fixture.projectId}`);
  await screen.getByRole('link', '閲覧数の詳細を見る').click();
  const ranking = browser.locator('.publication-view-details .publication-view-ranking');
  await expect(ranking).toContainText('詳細ページの閲覧数 上位5件');
  await expect(ranking).toContainText('集計済みの詳細閲覧はまだありません。');
  const viewRows = browser.locator('.publication-view-rows');
  await expect(viewRows).toContainText('E2Eの公開するストック');
  expect(await browser.evaluate(() => window.scrollY)).toBe(0);
  await expect(browser.locator('.publication-view-rows .public-view-count')).toHaveText('0');
  const pager = browser.locator('.publication-view-details .public-pagination');
  const previousPage = screen.getByRole('button', '前へ', { exact: true });
  const nextPage = screen.getByRole('button', '次へ', { exact: true });
  await expect(pager).toContainText('1 / 1ページ');
  await expect(previousPage).toBeDisabled();
  await expect(nextPage).toBeDisabled();
  await browser
    .locator('.publication-view-details button')
    .filter({ hasText: '問い・気づき' })
    .click();
  await expect(viewRows).toContainText(`E2Eのページ送り用の問い ${publicListPageSize}`);
  await expect(pager).toContainText('1 / 2ページ');
  await expect(previousPage).toBeDisabled();
  await nextPage.click();
  await expect(viewRows).toContainText('E2Eの公開する問い');
  await expect(pager).toContainText('2 / 2ページ');
  await expect(nextPage).toBeDisabled();
  await previousPage.click();
  await expect(pager).toContainText('1 / 2ページ');
  await nextPage.click();
  await expect(pager).toContainText('2 / 2ページ');
  await browser.locator('.publication-view-details button').filter({ hasText: 'プ譜' }).click();
  await expect(viewRows).toContainText('E2Eの公開プ譜タイトル');
  await expect(pager).toContainText('1 / 1ページ');
  await app.screenshot('publication-view-details');
  await screen.getByRole('link', 'プロジェクト設定に戻る').click();
  await screen.getByRole('switch', 'プロジェクトを公開する').uncheck();
  await screen.getByRole('button', '公開設定を保存').click();
  await expect(screen.getByRole('status').filter({ hasText: '非公開にしました。' })).toBeVisible();
  await expect(browser.locator('.publication-views')).toHaveCount(0);
  await app.open(`/#public-views/${fixture.projectId}`);
  await expect(screen.getByText('公開中のプロジェクトで閲覧数を確認できます。')).toBeVisible();
  await expect(viewRows).toHaveCount(0);
  await expect(ranking).toHaveCount(0);
  expect((await fetch(publicImageUrl)).status).toBe(404);
  for (const suffix of [
    '',
    '/stocks',
    `/stocks/${stock.id}`,
    '/pufus',
    `/pufus/${pufu.id}`,
    `/pufus/${pufu.id}?phase=1`,
  ])
    expect((await fetch(`${fixture.url}/api/public/projects/${publicId}${suffix}`)).status).toBe(
      404,
    );
  const revokedHtml = await fetch(`${fixture.url}/p/${publicId}/pufus/${pufu.id}`);
  expect(revokedHtml.status).toBe(404);
  expect(await revokedHtml.text()).not.toContain('E2Eの公開プ譜');
  expect(await (await fetch(`${fixture.url}/sitemap.xml`)).text()).not.toContain(publicId);
});
