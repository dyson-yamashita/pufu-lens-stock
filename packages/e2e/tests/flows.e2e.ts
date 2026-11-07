import { readFile } from 'node:fs/promises';
import { expect } from 'e2e';
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
  await screen.getByRole('button', 'ストックする').click();
  await expect(screen.getByRole('heading', 'E2Eで保存した本文')).toBeVisible();
  await app.open(`/#project/${fixture.projectId}`);
  await screen.getByRole('heading', 'E2Eで保存した本文').click();
  await screen.getByRole('button', '入力した本文').click();
  await expect(browser.locator('.article-body')).toContainText(sourceText);
  const data = (await fixture.request(`/stocks?project_id=${fixture.projectId}`)) as {
    stocks: { project_id: string; title: string; id: string }[];
  };
  expect(data.stocks).toHaveLength(1);
  expect(data.stocks[0].project_id).toBe(fixture.projectId);
  await screen.getByRole('button', '閉じる', { exact: true }).click();
  await expect(screen.getByRole('dialog')).toBeHidden();
  // MCPと同じ保存APIで本文採用したストックの表示を確認する。引数・権限・再送はVitestで検証。
  const verbatimText =
    '  原文の段落を保ちます。\n\n' + '長い本文を省略せず採用します。'.repeat(100) + '\n  ';
  const verbatim = await fixture.request('/stocks', 'POST', {
    type: 'text',
    project_id: fixture.projectId,
    title: 'E2E要約しない本文',
    text: verbatimText,
    skip_summary: true,
  });
  await app.open(`/#project/${fixture.projectId}`);
  await screen.getByRole('heading', 'E2E要約しない本文', { exact: true }).click();
  await expect(
    screen.getByText('要約せず、本文をそのまま表示しています。', { exact: true }),
  ).toBeVisible();
  await expect(browser.locator('.verbatim-content')).toHaveText(verbatimText);
  await browser.reload();
  await screen.getByRole('heading', 'E2E要約しない本文', { exact: true }).click();
  await expect(browser.locator('.verbatim-content')).toHaveText(verbatimText);
  expect(await fixture.request(`/stocks/${verbatim.id}`)).toMatchObject({
    stock: { summary: { overview: verbatimText, verbatim: true } },
  });
  const whiteSpace = await browser.evaluate(
    () => getComputedStyle(document.querySelector('.verbatim-content')!).whiteSpace,
  );
  expect(whiteSpace).toBe('pre-wrap');
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
  expect(before.publication.search_indexable).toBe(false);
  await agent.act(goals.publish);
  await expect(screen.getByRole('dialog', '公開前のご確認')).toBeHidden();
  const published = (await fixture.request(`/projects/${fixture.projectId}/publication`)) as {
    publication: { public_id: string; is_public: boolean };
  };
  expect(published.publication.is_public).toBe(true);
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
  const stock = await fixture.request('/stocks', 'POST', {
    project_id: fixture.projectId,
    type: 'text',
    title: 'E2Eの公開するストック',
    text: '公開プ譜の関連ストックの折りたたみを確認する本文です。',
  });
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
  expect(await initialHtml.text()).toContain('E2Eの公開プ譜・次の局面');
  expect(await (await fetch(`${fixture.url}/sitemaps/${publicId}/pufus-1.xml`)).text()).toContain(
    `/p/${publicId}/pufus/${pufu.id}`,
  );
  const cookies = await browser.cookies();
  await app.clearState();
  await app.open('/');
  await expect(
    browser.locator(`.public-project-card[href="/p/${publicId}"] .public-card-footer`),
  ).toContainText('1 プ譜');
  await app.open(`/p/${publicId}`);
  await expect(screen.getByRole('heading', fixture.projectName)).toBeVisible();
  await browser.locator('.public-tabs a').filter({ hasText: 'プ譜' }).click();
  await expect(browser.locator('.public-pufu-card h3')).toHaveText('E2Eの公開プ譜タイトル');
  await expect(browser.locator('.public-pufu-card h3 + p')).toHaveText('E2Eの公開プ譜・次の局面');
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
  await app.open(`/#settings/${fixture.projectId}`);
  await screen.getByRole('switch', 'プロジェクトを公開する').uncheck();
  await screen.getByRole('button', '公開設定を保存').click();
  await expect(screen.getByRole('status').filter({ hasText: '非公開にしました。' })).toBeVisible();
  for (const suffix of ['', '/pufus', `/pufus/${pufu.id}`, `/pufus/${pufu.id}?phase=1`])
    expect((await fetch(`${fixture.url}/api/public/projects/${publicId}${suffix}`)).status).toBe(
      404,
    );
  const revokedHtml = await fetch(`${fixture.url}/p/${publicId}/pufus/${pufu.id}`);
  expect(revokedHtml.status).toBe(404);
  expect(await revokedHtml.text()).not.toContain('E2Eの公開プ譜');
  expect(await (await fetch(`${fixture.url}/sitemap.xml`)).text()).not.toContain(publicId);
});
