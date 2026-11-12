import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect } from 'e2e';
import { test } from '../src/fixtures.ts';

for (const scenario of [
  {
    id: 'FEEDBACK-002',
    status: 409,
    reason: 'operation_repeat',
    message: '他の画面で更新されています。',
    title: '保存競合の反復だけで案内する',
  },
  {
    id: 'FEEDBACK-003',
    status: 503,
    reason: 'network_repeat',
    message: '処理に失敗しました。',
    title: '通信失敗の反復を別の理由として案内する',
  },
]) {
  test(`${scenario.id} ${scenario.title}`, async ({ app, screen, browser, fixture }) => {
    const score = JSON.parse(
      await readFile(new URL('../../../tests/fixtures/pufu-sparse.json', import.meta.url), 'utf8'),
    );
    const { pufu } = (await fixture.request('/pufus', 'POST', {
      project_id: fixture.projectId,
      request_id: randomUUID(),
      score,
    })) as { pufu: { id: string } };
    await app.open(`/#pufu/${pufu.id}`);
    await expect(browser.locator('.pufi-feedback')).toHaveCount(0);
    await screen.getByRole('button', '編集する', { exact: true }).click();
    await browser.route(`${fixture.url}/api/v1/pufus/${pufu.id}`, async (route) => {
      if (route.request.method !== 'PATCH') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: scenario.status,
        contentType: scenario.status === 503 ? 'text/html' : 'application/json',
        body:
          scenario.status === 503
            ? '<html>Service unavailable</html>'
            : JSON.stringify({ error: scenario.message }),
      });
    });
    const requests: { reasons: { type: string; action: string }[] }[] = [];
    await browser.route(`${fixture.url}/api/v1/feedback`, async (route) => {
      requests.push(JSON.parse(route.request.postData ?? '{}'));
      await route.continue();
    });
    await screen.getByRole('button', '保存', { exact: true }).click();
    await expect(screen.getByRole('alert')).toContainText(scenario.message);
    await expect(browser.locator('.pufi-prompt')).toHaveCount(0);
    await screen.getByRole('button', '保存', { exact: true }).click();
    await expect(browser.locator('.pufi-prompt')).toContainText('操作でお困りですか？');
    await screen.getByRole('button', 'はい', { exact: true }).click();
    await screen.getByRole('button', '反応しません', { exact: true }).click();
    await screen.getByLabel('プフィへの返答').fill('保存を繰り返し試しても失敗します。');
    await screen.getByRole('button', '送信して終了', { exact: true }).click();
    await expect(browser.locator('.pufi-thread')).toContainText('改善に役立てます');
    expect(requests).toHaveLength(1);
    expect(requests[0].reasons).toEqual([{ type: scenario.reason, action: 'save' }]);
    await screen.getByRole('button', '会話を閉じる', { exact: true }).click();
    await screen.getByRole('button', '閉じる', { exact: true }).click();
  });
}
