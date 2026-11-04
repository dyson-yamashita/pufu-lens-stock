import { expect } from 'e2e';
import { test } from '@e2e-dev/web';

test('FIRST-001 はじめの3ステップから記事を保存し、その記事の問いを書いて完了する', async ({
  app,
  screen,
  browser,
}) => {
  const address = new URL(app.baseUrl ?? 'about:blank');
  if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || !address.port)
    throw new Error('ローカル専用です。');
  const url = address.origin;
  await browser.route('**/*', async (route) => {
    if (new URL(route.request.url).origin === url) await route.continue();
    else await route.abort();
  });
  await app.open('/');
  await screen.getByRole('button', 'ローカルデモを開く').click();
  await expect(browser.locator('.onboarding-page, .app-shell')).toBeVisible();
  if (await screen.getByRole('heading', 'Pufu Lensへようこそ').isVisible()) {
    await browser.locator('#onboarding-name').fill('初回体験テスト');
    await browser.locator('#onboarding-terms').check();
    await browser.locator('#onboarding-privacy').check();
    await screen.getByRole('button', 'OK').click();
  }
  await expect(screen.getByRole('heading', 'すべてのストック')).toBeVisible();
  const cookie = (await browser.cookies()).map(({ name, value }) => `${name}=${value}`).join('; ');
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${url}/api/v1${path}`, {
      method,
      headers: { Origin: url, Cookie: cookie, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.ok).toBe(true);
    return response.json() as Promise<Record<string, unknown>>;
  };
  try {
    const data = (await request('/projects')) as { projects: { id: string }[] };
    for (const project of data.projects) await request(`/projects/${project.id}`, 'DELETE');
    await browser.reload();
    await expect(screen.getByRole('heading', '最初のプロジェクトをつくりましょう')).toBeVisible();
    await browser.locator('.first-steps').getByRole('button', 'プロジェクトを作成').click();
    await screen.getByLabel('プロジェクト名', { exact: true }).fill('初回体験プロジェクト');
    await browser.locator('dialog').getByRole('button', 'プロジェクトを作成').click();
    await expect(screen.getByRole('dialog', '新しいプロジェクト')).toBeHidden();
    const created = (await request('/projects')) as { projects: { id: string }[] };
    const projectId = created.projects[0].id;
    const other = await request('/projects', 'POST', {
      name: '別の保存先',
      show_in_all_lists: false,
    });
    const destination = String(other.id);
    await app.open(`/#project/${projectId}`);
    const guide = browser.locator('.first-steps');
    await expect(guide).toBeVisible();
    await expect(browser.locator('.first-steps .first-step-done')).toHaveCount(1);
    await app.screenshot('first-steps-light');
    await browser.emulateMedia({ colorScheme: 'dark' });
    await app.screenshot('first-steps-dark');
    await browser.emulateMedia({ colorScheme: 'light' });
    await guide.getByRole('button', '最初の記事をストック').click();
    await browser.locator('#stock-project').selectOption({ value: destination });
    await screen.getByRole('tab', 'テキスト').click();
    await screen
      .getByLabel('本文')
      .fill('初回体験の検証用の記事です。気になった点を問いとして残します。');
    await screen.getByRole('button', 'ストックする').click();
    await expect(browser.locator('.first-steps .first-step-done')).toHaveCount(2);
    await browser.locator('.toast').getByRole('button', '問い・気づきを追加').click();
    await expect(browser.locator('#question-project')).toHaveValue(destination);
    await expect(browser.locator('.relation-selected input')).toBeChecked();
    await browser.locator('#question-text').fill('この体験で次に確かめたいことは何か？');
    await browser.locator('dialog').getByRole('button', '問い・気づきを追加').click();
    await expect(screen.getByRole('dialog', '問い・気づきを追加')).toBeHidden();
    const saved = (await request(`/questions?source=user&project_id=${destination}`)) as {
      questions: { source: string; stock_ids: string[]; text: string }[];
    };
    expect(saved.questions).toHaveLength(1);
    expect(saved.questions[0].source).toBe('user');
    expect(saved.questions[0].stock_ids).toHaveLength(1);
    await app.open(`/#project/${projectId}`);
    await expect(
      browser.locator('.empty-state').getByRole('button', '最初の記事をストック'),
    ).toBeVisible();
    await expect(guide).toHaveCount(0);
    await browser.reload();
    await expect(
      browser.locator('.empty-state').getByRole('button', '最初の記事をストック'),
    ).toBeVisible();
    await expect(guide).toHaveCount(0);
  } finally {
    // Reset the dummy account, so following scenarios receive their normal demo
    // examples and the existing replay recordings remain independent.
    await request('/me', 'DELETE', {});
  }
});
