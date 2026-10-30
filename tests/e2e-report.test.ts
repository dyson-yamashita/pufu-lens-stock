import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { writeHtmlReport, withHtmlReport, reportDirectory } from '../scripts/e2e/report';

const owned: string[] = [];
afterEach(async () => {
  await Promise.all(owned.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const report = () => ({
  schemaVersion: 'report-1',
  run: {
    id: 'run-example',
    status: 'failed',
    startedAt: '2026-10-30T06:00:00Z',
    finishedAt: '2026-10-30T06:00:03Z',
    summary: { selected: 3, passed: 1, failed: 1, skipped: 1 },
    usage: { modelTokens: 0, maxModelCallsInStep: 0 },
    results: [
      {
        id: 'a'.repeat(64),
        titlePath: ['STOCK-001 本文を保存'],
        targetId: 'desktop',
        selected: true,
        status: 'passed',
        attempts: [
          {
            durationMs: 1234,
            error: undefined as { code: string; message: string } | undefined,
            artifacts: [] as { kind: string; path: string }[],
            steps: [{ api: 'locator.click', label: '記事をストック', status: 'passed' }],
          },
        ],
      },
      {
        id: 'b'.repeat(64),
        titlePath: ['PUFU-001 プ譜を保存'],
        targetId: 'phone',
        selected: true,
        status: 'failed',
        attempts: [
          {
            durationMs: 2000,
            error: { code: 'ASSERTION_FAILED', message: '保存後の目標が一致しません' },
            steps: [],
            artifacts: [
              {
                kind: 'screenshot',
                path: 'flows-pufu-bbbbbbbbbbbbbbbb/attempt-1/screenshots/失敗 #1.png',
              },
            ],
          },
        ],
      },
      {
        id: 'c'.repeat(64),
        titlePath: ['PUBLIC-001 公開設定'],
        targetId: 'phone',
        selected: true,
        status: 'skipped',
        attempts: [],
      },
    ],
  },
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pufu-e2e-report-test-'));
  owned.push(root);
  const runs = join(root, '.e2e/runs'),
    output = join(runs, 'run-example');
  await mkdir(output, { recursive: true });
  return { root, runs, output };
}

describe('E2E HTMLレポート', () => {
  it('成功・失敗・スキップ、対象画面、手順と失敗情報をブラウザーで読める形にする', async () => {
    const { runs, output } = await fixture();
    await writeFile(join(output, 'report.json'), JSON.stringify(report()));
    const file = await writeHtmlReport(output, runs);
    expect(file).toBe(join(output, 'index.html'));
    const { document } = parseHTML(await readFile(file, 'utf8'));
    expect(document.body.textContent).toContain('STOCK-001 本文を保存');
    expect(document.body.textContent).toContain('desktop');
    expect(document.body.textContent).toContain('phone');
    expect(document.body.textContent).toContain('成功');
    expect(document.body.textContent).toContain('失敗');
    expect(document.body.textContent).toContain('スキップ');
    expect(document.body.textContent).toContain('記事をストック');
    expect(document.body.textContent).toContain('保存後の目標が一致しません');
    expect(document.querySelectorAll('details')).toHaveLength(3);
    expect(document.querySelector('script')).toBeNull();
  });

  it('存在する添付とtraceだけを相対リンクにし、日本語・空白・#を含むファイル名も開ける', async () => {
    const { runs, output } = await fixture();
    const path = report().run.results[1].attempts[0].artifacts![0].path;
    await mkdir(join(output, 'results', path, '..'), { recursive: true });
    await writeFile(join(output, 'results', path), 'dummy screenshot');
    await writeFile(join(output, 'results/flows-pufu-bbbbbbbbbbbbbbbb/trace.md'), 'trace');
    await writeFile(join(output, 'report.json'), JSON.stringify(report()));
    const { document } = parseHTML(await readFile(await writeHtmlReport(output, runs), 'utf8'));
    const links = [...document.querySelectorAll('a')].map((link) => link.getAttribute('href'));
    expect(links).toContain(
      './results/flows-pufu-bbbbbbbbbbbbbbbb/attempt-1/screenshots/%E5%A4%B1%E6%95%97%20%231.png',
    );
    expect(links).toContain('./results/flows-pufu-bbbbbbbbbbbbbbbb/trace.md');
    expect(document.querySelector('img')?.getAttribute('src')).toBe(
      links.find((link) => link?.endsWith('.png')),
    );
  });

  it('テスト名・操作名・エラーをHTMLとして実行せず、外部URL・../・symlinkの添付を開かない', async () => {
    const { runs, output, root } = await fixture();
    const data = report();
    const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    data.run.results[0].titlePath = [payload];
    data.run.results[0].attempts[0].steps[0].label = payload;
    data.run.results[1].attempts[0].error!.message = payload;
    data.run.results[1].attempts[0].artifacts = [
      { kind: 'screenshot', path: '../../../outside.png' },
      { kind: 'screenshot', path: 'https://external.invalid/image.png' },
      { kind: 'screenshot', path: 'linked.png' },
    ];
    await mkdir(join(output, 'results'));
    await writeFile(join(root, 'outside.png'), 'outside');
    await symlink(join(root, 'outside.png'), join(output, 'results/linked.png'));
    await writeFile(join(output, 'report.json'), JSON.stringify(data));
    const { document } = parseHTML(await readFile(await writeHtmlReport(output, runs), 'utf8'));
    expect(document.body.textContent).toContain(payload);
    expect(document.querySelector('script, [onerror], img')).toBeNull();
    expect(
      [...document.querySelectorAll('a')].every(
        (link) => !/external|outside|linked/.test(link.getAttribute('href') ?? ''),
      ),
    ).toBe(true);
  });

  it('起動前の失敗もHTMLへ残し、元のJSONは変更しない', async () => {
    const { runs, output } = await fixture();
    const summary = JSON.stringify({
      mode: 'ci',
      status: 'failed',
      selected: ['STOCK-001'],
      targets: ['desktop'],
      error: 'サーバーを起動できませんでした',
    });
    await writeFile(join(output, 'run-summary.json'), summary);
    const { document } = parseHTML(await readFile(await writeHtmlReport(output, runs), 'utf8'));
    expect(document.body.textContent).toContain('サーバーを起動できませんでした');
    expect(document.body.textContent).toContain('個別のテスト結果はありません');
    expect(document.body.textContent).not.toContain('すべて成功');
    expect(await readFile(join(output, 'run-summary.json'), 'utf8')).toBe(summary);
  });

  it('実行フォルダー外やsymlinkへの書込み、データがない実行は明示的に拒否する', async () => {
    const { runs, output, root } = await fixture();
    await expect(writeHtmlReport(root, runs)).rejects.toThrow();
    await expect(writeHtmlReport(output, runs)).rejects.toThrow();
    await writeFile(join(output, 'report.json'), JSON.stringify(report()));
    const outside = join(root, 'outside.html');
    await writeFile(outside, 'keep');
    await symlink(outside, join(output, 'index.html'));
    await expect(writeHtmlReport(output, runs)).rejects.toThrow();
    expect(await readFile(outside, 'utf8')).toBe('keep');
  });
});

describe('HTMLレポートと実行結果の保持', () => {
  it('SDKが失敗なのに保存済みsummaryが成功でも、全体を成功表示しない', async () => {
    const { runs, output } = await fixture();
    await writeFile(join(output, 'report.json'), JSON.stringify(report()));
    await writeFile(
      join(output, 'run-summary.json'),
      JSON.stringify({
        mode: 'ci',
        status: 'passed',
        selected: ['STOCK-001'],
        targets: ['desktop'],
      }),
    );
    const { document } = parseHTML(await readFile(await writeHtmlReport(output, runs), 'utf8'));
    expect(document.querySelector('header .badge')?.textContent).toBe('失敗');
  });

  it('起動処理が失敗してもHTMLを作り、元の失敗を呼出元へ返す', async () => {
    const { runs, output } = await fixture();
    const failure = new Error('Workerの起動失敗');
    await expect(
      withHtmlReport(
        output,
        { mode: 'ci', selected: ['STOCK-001'], targets: ['desktop'] },
        async () => {
          throw failure;
        },
        runs,
      ),
    ).rejects.toBe(failure);
    const { document } = parseHTML(await readFile(join(output, 'index.html'), 'utf8'));
    expect(document.body.textContent).toContain('Workerの起動失敗');
    expect(JSON.parse(await readFile(join(output, 'run-summary.json'), 'utf8')).status).toBe(
      'failed',
    );
  });

  it('HTMLを書けない場合も元のテスト失敗を失わない', async () => {
    const { runs, output, root } = await fixture();
    const failure = new Error('テスト失敗');
    await writeFile(join(root, 'keep.html'), 'keep');
    await symlink(join(root, 'keep.html'), join(output, 'index.html'));
    const result = withHtmlReport(
      output,
      { mode: 'ci', selected: ['STOCK-001'], targets: ['desktop'] },
      async () => {
        throw failure;
      },
      runs,
    );
    await expect(result).rejects.toMatchObject({ errors: expect.arrayContaining([failure]) });
    expect(await readFile(join(root, 'keep.html'), 'utf8')).toBe('keep');
  });

  it('再生成は最新の結果を選び、未実行フォルダーとsymlinkを選ばない', async () => {
    const { runs, output, root } = await fixture();
    await writeFile(join(output, 'report.json'), JSON.stringify(report()));
    await mkdir(join(runs, 'empty'));
    await symlink(root, join(runs, 'linked'));
    expect(await reportDirectory(undefined, runs)).toBe(output);
    await expect(reportDirectory('../escape', runs)).rejects.toThrow();
  });
});

it('SDKの実行全体のエラー形式を読み、ブラウザー起動前の失敗を表示する', async () => {
  const { runs, output } = await fixture();
  const data = report();
  const native = {
    ...data,
    run: {
      ...data.run,
      status: 'error',
      results: [],
      errors: [
        {
          category: 'infrastructure',
          code: 'BROWSER_INSTALL_FAILED',
          message: 'ブラウザーの準備に失敗しました',
        },
      ],
    },
  };
  await writeFile(join(output, 'report.json'), JSON.stringify(native));
  const { document } = parseHTML(await readFile(await writeHtmlReport(output, runs), 'utf8'));
  expect(document.querySelector('header .badge')?.textContent).toBe('エラー');
  expect(document.body.textContent).toContain('ブラウザーの準備に失敗しました');
});
