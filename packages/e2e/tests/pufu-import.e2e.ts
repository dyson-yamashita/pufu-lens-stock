import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'e2e';
import { test } from '../src/fixtures.ts';

test('PUFU-002 JSONから作成し局面への取込を保存して再読込する', async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  const scratch = await mkdtemp(join(tmpdir(), 'pufu-json-e2e-'));
  try {
    const score = JSON.parse(
      await readFile(new URL('../../../tests/fixtures/pufu-sparse.json', import.meta.url), 'utf8'),
    );
    score.gainingGoal.text = 'JSON取込の目標';
    score.winCondition.comment.text = 'JSON取込のコメント';
    score.purposes[0].measures[0].color = 'red';
    score.purposes[0].measures[0].progress = 65;
    const original = join(scratch, 'original.json');
    const replacement = join(scratch, 'replacement.json');
    const invalid = join(scratch, 'invalid.json');
    const changed = structuredClone(score);
    changed.gainingGoal.text = 'JSONから置き換えた局面';
    await writeFile(original, JSON.stringify(score));
    await writeFile(replacement, JSON.stringify(changed));
    await writeFile(invalid, '{}');
    await app.open('/#pufus');
    await screen.getByRole('button', 'プ譜を追加').click();
    await browser.locator('#pufu-project').selectOption({ value: fixture.projectId });
    await screen.getByLabel('作成方法').selectOption({ value: 'json' });
    await screen.getByLabel('タイトル任意').fill('JSONで作成したプ譜');
    await expect(screen.getByRole('button', 'プ譜を作成')).toBeDisabled();
    await browser.locator('input[type="file"]').setInputFiles(invalid);
    await expect(screen.getByRole('alert')).toContainText('プ譜の形式が正しくない');
    await expect(screen.getByRole('button', 'プ譜を作成')).toBeDisabled();
    await browser.locator('input[type="file"]').setInputFiles(original);
    await expect(screen.getByRole('status')).toContainText(score.gainingGoal.text);
    await screen.getByRole('button', 'プ譜を作成').click();
    await expect(screen.getByRole('heading', 'JSONで作成したプ譜')).toBeVisible();
    const { pufus } = (await fixture.request('/pufus')) as { pufus: { id: string }[] };
    expect(pufus).toHaveLength(1);
    const id = pufus[0].id;
    expect(await fixture.request(`/pufus/${id}`)).toMatchObject({
      pufu: { score, status: 'ready' },
    });
    await app.open(`/#pufu/${id}`);
    await screen.getByRole('button', '局面を追加').click();
    await expect(browser.locator('.pufu-phase-number')).toHaveText('第2局面');
    await screen.getByRole('button', '編集する').click();
    const gainingGoal = browser.locator('.pufu-editor-root textarea[role="gaining-goal"]');
    await browser.locator('input[type="file"]').setInputFiles(replacement);
    await expect(gainingGoal).toHaveValue(changed.gainingGoal.text);
    // インポートだけではサーバーに保存しない。
    expect(await fixture.request(`/pufus/${id}`)).toMatchObject({ pufu: { score } });
    await browser.locator('input[type="file"]').setInputFiles(invalid);
    await expect(screen.getByRole('alert')).toContainText('プ譜の形式が正しくない');
    await expect(gainingGoal).toHaveValue(changed.gainingGoal.text);
    let markDismissed!: () => void;
    const dismissed = new Promise<void>((resolve) => {
      markDismissed = resolve;
    });
    const dismiss = await browser.onDialog(async (dialog) => {
      expect(dialog.type).toBe('confirm');
      await dialog.dismiss();
      markDismissed();
    });
    await browser.locator('input[type="file"]').setInputFiles(original);
    await dismissed;
    await expect(gainingGoal).toHaveValue(changed.gainingGoal.text);
    await dismiss();
    await screen.getByRole('button', '保存', { exact: true }).click();
    await expect(
      screen.getByRole('status').filter({ hasText: 'プ譜を保存しました。' }),
    ).toBeVisible();
    await screen.getByRole('button', '閉じる').click();
    await browser.reload();
    await expect(browser.locator('.pufu-context-task')).toContainText(changed.gainingGoal.text);
    expect(await fixture.request(`/pufus/${id}`)).toMatchObject({
      pufu: {
        current_phase: 2,
        phases: [
          { number: 1, score },
          { number: 2, score: changed },
        ],
      },
    });
    await screen.getByRole('button', '前の局面へ').click();
    await screen.getByRole('button', 'ダウンロード', { exact: true }).click();
    const download = await browser.waitForDownload(() =>
      screen.getByRole('button', 'JSON', { exact: true }).click(),
    );
    expect(JSON.parse(await readFile(download.absolutePath, 'utf8'))).toEqual(score);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
