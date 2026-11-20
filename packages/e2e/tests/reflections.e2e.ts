import { expect } from 'e2e';
import { test } from '../src/fixtures.ts';

test('REFLECTION-001 周期を設定し、自動で届いた問いの記録と回答を確認する', async ({
  app,
  browser,
  screen,
  fixture,
}) => {
  const settingsPath = `/#settings/${fixture.projectId}`;
  await app.open(settingsPath);
  const advanced = browser.locator('.project-advanced summary');
  await advanced.click();
  const frequency = screen.getByRole('combobox', '振り返りの周期', { exact: true });
  await expect(frequency).toHaveValue('weekly');
  await frequency.selectOption({ label: '毎月' });
  await screen.getByRole('button', '保存', { exact: true }).click();
  await expect(screen.getByText('プロジェクトの設定を保存しました。')).toBeVisible();
  await browser.reload();
  await advanced.click();
  await expect(frequency).toHaveValue('monthly');

  const title = '説明の変化を観察した記録';
  const records = [
    [title, '操作を観察して、説明文を短くした。'],
    ['説明を短くした後の反応', '初回に迷った人が減った。'],
    ['もう一度見た操作の順番', '最後に確認の画面を開いた。'],
  ];
  const stockIds = [];
  for (const [title, text] of records) {
    const { id } = await fixture.request('/stocks', 'POST', {
      project_id: fixture.projectId,
      type: 'text',
      title,
      text,
    });
    stockIds.push(id);
  }
  await app.open(`/#questions/${fixture.projectId}`);
  await expect(screen.getByRole('heading', '振り返り', { exact: true })).toBeVisible();
  await expect(screen.getByText('期間を選んで振り返る', { exact: true })).toHaveCount(0);
  const jstOffset = 9 * 3600000;
  const today = new Date(Date.now() + jstOffset);
  const cutoff = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1) - jstOffset;
  const { projects } = (await fixture.request('/projects')) as {
    projects: { id: string; name: string; description: string; auto_generate_questions: boolean }[];
  };
  const otherProjects = projects.filter(
    (project) => project.id !== fixture.projectId && project.auto_generate_questions,
  );
  const setOtherSchedules = (enabled: boolean) =>
    Promise.all(
      otherProjects.map(({ id, name, description }) =>
        fixture.request(`/projects/${id}`, 'PATCH', {
          name,
          description,
          auto_generate_questions: enabled,
        }),
      ),
    );
  try {
    await setOtherSchedules(false);
    const scheduled = await fetch(`${fixture.url}/api/__e2e__/scheduled?time=${cutoff}`, {
      method: 'POST',
    });
    expect(scheduled.status).toBe(204);
  } finally {
    await setOtherSchedules(true);
  }

  const card = browser.locator('.reflection-card');
  const source = card.getByRole('button', new RegExp(title));
  await expect(source).toBeVisible({ timeout: 30000 });
  await expect(browser.locator('.reflection-card .question-text')).toContainText(title);
  await source.click();
  await expect(screen.getByRole('heading', title, { exact: true })).toBeVisible();
  await browser.back();
  await expect(source).toBeVisible();

  const answer = '説明を短くする前に、最初の操作で迷う場所を見ておく。';
  await card.getByLabel('気づいたこと', { exact: true }).fill(answer);
  await card.getByRole('button', '振り返りとして保存', { exact: true }).click();
  await expect(card.getByText(answer, { exact: true })).toBeVisible();
  await browser.reload();
  await expect(card.getByText(answer, { exact: true })).toBeVisible();
  const result = await fixture.request(`/reflections?project_id=${fixture.projectId}`);
  const [saved] = result.reflections as {
    answer: string;
    end_at: string;
    stocks: { id: string }[];
  }[];
  expect(saved.answer).toBe(answer);
  expect(saved.end_at).toBe(new Date(cutoff).toISOString());
  expect(saved.stocks.map(({ id }) => id)).toEqual([stockIds[0]]);
});
