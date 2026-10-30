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
  const { pufu } = (await fixture.request('/pufus', 'POST', {
    project_id: fixture.projectId,
    request_id: requestId(),
    score,
  })) as { pufu: { id: string } };
  await app.open('/#pufus');
  await screen.getByRole('button', /E2Eプ譜の目標/).click();
  await expect(screen.getByRole('button', '編集する')).toBeVisible();
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
  await app.open(`/#pufu/${pufu.id}`);
  await expect(browser.locator('.pufu-phase-number')).toHaveText('第2局面');
  await screen.getByRole('button', '前の局面へ').click();
  await expect(browser.locator('.pufu-phase-number')).toHaveText('第1局面');
  const saved = (await fixture.request(`/pufus/${pufu.id}`)) as {
    pufu: {
      current_phase: number;
      phases: { number: number; score: { gainingGoal: { text: string } } }[];
    };
  };
  expect(saved.pufu.current_phase).toBe(2);
  expect(saved.pufu.phases.map(({ score }) => score.gainingGoal.text)).toEqual([
    'E2Eプ譜の編集済み目標',
    'E2Eプ譜の次局面の目標',
  ]);
  await app.open('/#pufus');
  await screen.getByRole('button', /E2Eプ譜の次局面の目標/).click();
  await screen.getByRole('button', 'プ譜の一覧に戻る').click();
  await expect(screen.getByRole('heading', 'すべてのプ譜')).toBeVisible();
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
    publication: { public_id: string | null; is_public: boolean };
  };
  expect(before.publication.is_public).toBe(false);
  await agent.act(goals.publish);
  await expect(screen.getByRole('dialog', '公開前のご確認')).toBeHidden();
  const published = (await fixture.request(`/projects/${fixture.projectId}/publication`)) as {
    publication: { public_id: string; is_public: boolean };
  };
  expect(published.publication.is_public).toBe(true);
  const publicId = published.publication.public_id;
  expect((await fetch(`${fixture.url}/api/public/projects/${publicId}`)).status).toBe(200);
  const cookies = await browser.cookies();
  await app.clearState();
  await app.open(`/p/${publicId}`);
  await expect(screen.getByRole('heading', fixture.projectName)).toBeVisible();
  await browser.setCookies(cookies);
  await app.open(`/#settings/${fixture.projectId}`);
  await screen.getByRole('switch', 'プロジェクトを公開する').uncheck();
  await screen.getByRole('button', '公開設定を保存').click();
  await expect(screen.getByRole('status').filter({ hasText: '非公開にしました。' })).toBeVisible();
  expect((await fetch(`${fixture.url}/api/public/projects/${publicId}`)).status).toBe(404);
});
