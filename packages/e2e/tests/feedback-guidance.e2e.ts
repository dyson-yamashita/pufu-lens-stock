import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect } from 'e2e';
import { test } from '../src/fixtures.ts';
import type { ThemePreference } from '../../../src/theme';

test('FEEDBACK-004 ログイン済みマニュアルから案内し、未解決の部分をヒアリングする', async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  await app.open('/manual');
  const invitation = screen.getByRole('button', '何かお困りですか？', { exact: true });
  await expect(invitation).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await browser.evaluate(async (value) => {
      window.pufuTheme.setPreference(value as ThemePreference);
      void document.documentElement.offsetWidth;
      await Promise.all(
        document
          .getAnimations()
          .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime))
          .map((a) => a.finished.catch(() => undefined)),
      );
      return null;
    }, theme);
    expect(
      await browser.evaluate(() => {
        const label = document.querySelector('.pufi-invitation')!.getBoundingClientRect(),
          icon = document.querySelector('.pufi-avatar')!.getBoundingClientRect();
        return (
          label.left >= 0 &&
          label.right < icon.left &&
          icon.right <= innerWidth &&
          icon.bottom <= innerHeight
        );
      }),
    ).toBe(true);
    await app.screenshot(`pufi-manual-entry-${theme}`);
  }
  let searches = 0;
  await browser.route(`${fixture.url}/api/v1/feedback/manual-search`, async (route) => {
    searches++;
    const { choices } = JSON.parse(route.request.postData ?? '{}') as {
      choices: { title: string }[];
    };
    let selection = choices.findIndex((c) => c.title.includes('JSON・画像'));
    if (selection < 0) selection = choices.findIndex((c) => c.title.includes('ダウンロード'));
    if (selection < 0) selection = choices.findIndex((c) => c.title.includes('プ譜'));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ selection: Math.max(0, selection), available: true }),
    });
  });
  const reports: {
    screen: string;
    detail: string;
    manual_context: { question: string; section: string };
  }[] = [];
  // The production D1 contract is covered by Vitest; do not exceed the real demo account's daily report quota.
  await browser.route(`${fixture.url}/api/v1/feedback`, async (route) => {
    reports.push(JSON.parse(route.request.postData ?? '{}'));
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ received: true, round: 0, follow_up: null, pending: false }),
    });
  });
  await invitation.click();
  await expect(screen.getByRole('button', 'プフィの設定')).toHaveCount(0);
  await expect(screen.getByLabel('声かけを受け取る')).toHaveCount(0);
  await screen.getByRole('button', '操作に迷いました', { exact: true }).click();
  await screen
    .getByLabel('プフィへの返答')
    .fill('プ譜を画像でダウンロードする方法を教えてください');
  await screen.getByRole('button', 'マニュアルを検索', { exact: true }).click();
  await expect(browser.locator('.pufi-thread')).toContainText('お役に立ちましたか？');
  await expect(browser.locator('.pufi-manual-link')).toHaveAttribute(
    'href',
    /\/manual#manual-pufu-/,
  );
  expect(searches).toBeGreaterThanOrEqual(2);
  expect(reports).toHaveLength(0);
  const before = searches;
  const documentCreatedAt = await browser.evaluate(() => performance.timeOrigin);
  await browser.locator('.pufi-manual-link').click();
  await expect(screen.getByRole('button', '会話に戻る', { exact: true })).toBeVisible();
  await expect(browser.locator('.pufi-panel')).toHaveAttribute('hidden', '');
  expect(
    await browser.evaluate(async () => {
      const target = document.querySelector<HTMLElement>('.manual-target-highlight');
      if (!target) return false;
      const until = performance.now() + 2500;
      await new Promise<void>((resolve) => {
        const ready = () => {
          const top = target.getBoundingClientRect().top;
          if ((top >= 0 && top < innerHeight / 2) || performance.now() > until) resolve();
          else requestAnimationFrame(ready);
        };
        ready();
      });
      return (
        target.getBoundingClientRect().top >= 0 &&
        target.getBoundingClientRect().top < innerHeight / 2 &&
        Boolean(target.closest('details[open]')) &&
        document.activeElement === target
      );
    }),
  ).toBe(true);
  expect(await browser.evaluate(() => performance.timeOrigin)).toBe(documentCreatedAt);
  await app.screenshot('pufi-manual-location');
  await screen.getByRole('button', '会話に戻る', { exact: true }).click();
  await expect(browser.locator('.pufi-thread')).toContainText('お役に立ちましたか？');
  expect(searches).toBe(before);

  await screen.getByRole('button', '解決しませんでした', { exact: true }).click();
  await expect(browser.locator('.pufi-thread')).toContainText('どの部分が解決しませんでしたか？');
  expect(searches).toBe(before);
  await screen.getByLabel('プフィへの返答').fill('画像を選んだ後、保存先がどこか分かりません');
  await screen.getByRole('button', '送信', { exact: true }).click();
  await expect(browser.locator('.pufi-thread')).toContainText('改善に役立てます');
  expect(searches).toBe(before);
  expect(reports).toHaveLength(1);
  expect(reports[0].screen).toBe('manual');
  expect(reports[0].detail).toContain('保存先がどこか');
  expect(reports[0].manual_context.question).toContain('画像でダウンロード');
  expect(reports[0].manual_context.section).toMatch(/^manual-pufu-/);
  await screen.getByRole('button', '会話を閉じる', { exact: true }).click();
  await expect(invitation).toBeVisible();
});

test('FEEDBACK-005 通常のプ譜表示・局面往復・機能開閉だけでは表示しない', async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  const score = JSON.parse(
    await readFile(new URL('../../../tests/fixtures/pufu-sparse.json', import.meta.url), 'utf8'),
  );
  const { pufu } = (await fixture.request('/pufus', 'POST', {
    project_id: fixture.projectId,
    request_id: randomUUID(),
    score,
  })) as { pufu: { id: string } };
  await app.open(`/#pufu/${pufu.id}`);
  await screen.getByRole('button', '局面を追加', { exact: true }).click();
  await expect(browser.locator('.pufu-phase-number')).toHaveText('第2局面');
  await expect(browser.locator('.pufi-feedback')).toHaveCount(0);
  for (let i = 0; i < 3; i++) {
    await screen.getByRole('button', '前の局面へ', { exact: true }).click();
    await screen.getByRole('button', '次の局面へ', { exact: true }).click();
    await screen.getByRole('button', 'ダウンロード', { exact: true }).click();
    await screen.getByRole('button', '閉じる', { exact: true }).click();
  }
  await browser.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 3500));
    return null;
  });
  await expect(browser.locator('.pufi-feedback')).toHaveCount(0);
});

test('FEEDBACK-010 ログイン方法の短い質問に手順を直接回答する', async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  await app.open('/manual');
  const requests: { question: string; choices: { title: string; preview: string }[] }[] = [];
  await browser.route(`${fixture.url}/api/v1/feedback/manual-search`, async (route) => {
    const input = JSON.parse(route.request.postData ?? '{}');
    requests.push(input);
    // This fixture selects from the evidence actually sent, rather than assuming a branch index.
    const selection = input.choices.findIndex((choice: { preview: string }) =>
      choice.preview.includes('Googleでログイン'),
    );
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ selection: selection < 0 ? null : selection, available: true }),
    });
  });
  let reports = 0;
  await browser.route(`${fixture.url}/api/v1/feedback`, async (route) => {
    reports++;
    await route.abort();
  });
  await screen.getByRole('button', '何かお困りですか？', { exact: true }).click();
  await screen.getByRole('button', '操作に迷いました', { exact: true }).click();
  await screen.getByLabel('プフィへの返答').fill('ログイン方法');
  await screen.getByRole('button', 'マニュアルを検索', { exact: true }).click();
  await expect(browser.locator('.pufi-thread')).toContainText(
    'トップページの「Googleでログイン」を押し',
  );
  await expect(browser.locator('.pufi-thread')).toContainText('Googleアカウントを選びます');
  await expect(browser.locator('.pufi-thread')).toContainText('お役に立ちましたか？');
  await expect(browser.locator('.pufi-manual-link')).toHaveAttribute(
    'href',
    '/manual#manual-sign-in',
  );
  await expect(screen.getByRole('button', '記事をストックする', { exact: true })).toHaveCount(0);
  expect(
    await browser.evaluate(() => {
      const thread = document.querySelector('.pufi-thread')!;
      const answer = [...thread.querySelectorAll('.pufi-message-pufi')].find((node) =>
        node.textContent?.startsWith('トップページの「Googleでログイン」'),
      );
      if (!answer) return false;
      const rect = answer.getBoundingClientRect(),
        visible = thread.getBoundingClientRect();
      return rect.top >= visible.top - 1 && rect.bottom <= visible.bottom + 1;
    }),
  ).toBe(true);
  expect(requests.length).toBe(2);
  expect(requests[0].question).toBe('ログイン方法');
  expect(requests[0].choices[0].preview).toContain('Googleでログイン');
  expect(reports).toBe(0);
  await app.screenshot('pufi-login-answer');
  const showAnswer = screen.getByRole('button', '回答を表示する', { exact: true });
  await expect(showAnswer).toHaveAttribute('aria-expanded', 'false');
  await showAnswer.click();
  await expect(browser.locator('.pufi-thread')).toContainText(
    '完了するまでは、再度ログインしても登録画面が表示されます。',
  );
  await expect(screen.getByRole('button', '折りたたむ', { exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(
    await browser.evaluate(() => {
      const thread = document.querySelector('.pufi-thread')!;
      const answer = [...thread.querySelectorAll('.pufi-message-pufi')].find((node) =>
        node.textContent?.startsWith('トップページの「Googleでログイン」'),
      )!;
      return answer.getBoundingClientRect().top >= thread.getBoundingClientRect().top - 1;
    }),
  ).toBe(true);
  expect(requests.length).toBe(2);
  expect(reports).toBe(0);
  for (const theme of ['light', 'dark']) {
    await browser.evaluate(async (value) => {
      window.pufuTheme.setPreference(value as ThemePreference);
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
          .map((animation) => animation.finished.catch(() => undefined)),
      );
      return null;
    }, theme);
    await app.screenshot(`pufi-full-answer-${theme}`);
  }

  await screen.getByRole('button', '折りたたむ', { exact: true }).click();
  await expect(showAnswer).toHaveAttribute('aria-expanded', 'false');

  await screen.getByRole('button', '解決しました', { exact: true }).click();
  await screen.getByRole('button', '会話を閉じる', { exact: true }).click();
  expect(reports).toBe(0);
});
