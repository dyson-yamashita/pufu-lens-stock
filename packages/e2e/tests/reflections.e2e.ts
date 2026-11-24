import { expect } from 'e2e';
import { test } from '../src/fixtures.ts';

test('REFLECTION-001 周期を設定し、振り返りの問いが通常の一覧に追加される', async ({
  app,
  browser,
  screen,
  fixture,
}) => {
  const settingsPath = `/#settings/${fixture.projectId}`;
  await app.open(settingsPath);
  const projectName = screen.getByRole('textbox', 'プロジェクト名', { exact: true });
  await expect(projectName).toBeVisible();
  await expect(projectName).not.toBeFocused();
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
  await expect(screen.getByRole('heading', '振り返り', { exact: true })).toHaveCount(0);
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

  const card = browser.locator('.question-grid .question-card');
  const source = card.getByRole('button', title, { exact: true });
  await expect(source).toBeVisible({ timeout: 30000 });
  await expect(browser.locator('.question-grid .question-text')).toContainText(title);
  await source.click();
  await expect(screen.getByRole('heading', title, { exact: true })).toBeVisible();
  await browser.back();
  await expect(source).toBeVisible();

  await card.getByRole('button', /問い・気づきの詳細を開く/).click();
  const noteTab = screen.getByRole('tab', 'メモ', { exact: true });
  await noteTab.click();
  const note = '説明を短くする前に、最初の操作で迷う場所を見ておく。';
  const input = screen.getByRole('textbox', 'メモ', { exact: true });
  await input.fill(note);
  await screen.getByRole('button', '変更を保存', { exact: true }).click();
  await expect(screen.getByText('メモを保存しました。', { exact: true })).toBeVisible();
  await browser.reload();
  await noteTab.click();
  await expect(input).toHaveValue(note);
  const result = await fixture.request(
    `/questions?project_id=${fixture.projectId}&include_reflections=true`,
  );
  const [saved] = result.questions as {
    id: string;
    is_reflection: number;
    stocks: { id: string }[];
  }[];
  expect(saved.is_reflection).toBe(1);
  expect(saved.stocks.map(({ id }) => id)).toEqual([stockIds[0]]);
  const { question } = (await fixture.request(`/questions/${saved.id}`)) as {
    question: { note: string };
  };
  expect(question.note).toBe(note);
});
