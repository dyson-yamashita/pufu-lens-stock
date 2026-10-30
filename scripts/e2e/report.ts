import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, extname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { z } from 'zod';
import { stripVTControlCharacters } from 'node:util';

export const runsRoot = resolve(import.meta.dirname, '../../packages/e2e/.e2e/runs');
const errorSchema = z.object({ code: z.string().optional(), message: z.string() });
const reportSchema = z.object({
  schemaVersion: z.literal('report-1'),
  run: z.object({
    id: z.string(),
    status: z.string(),
    startedAt: z.string().optional(),
    finishedAt: z.string().optional(),
    summary: z.object({
      selected: z.number(),
      passed: z.number(),
      failed: z.number(),
      skipped: z.number(),
    }),
    usage: z.object({ modelTokens: z.number(), maxModelCallsInStep: z.number() }).optional(),
    errors: z.array(errorSchema).optional(),
    results: z.array(
      z.object({
        id: z.string(),
        titlePath: z.array(z.string()),
        targetId: z.string(),
        selected: z.boolean(),
        status: z.string(),
        attempts: z.array(
          z.object({
            durationMs: z.number().optional(),
            error: errorSchema.optional(),
            steps: z
              .array(
                z.object({
                  api: z.string(),
                  label: z.string().optional(),
                  status: z.string(),
                  durationMs: z.number().optional(),
                }),
              )
              .optional(),
            artifacts: z.array(z.object({ kind: z.string(), path: z.string() })).optional(),
          }),
        ),
      }),
    ),
  }),
});
const summarySchema = z.object({
  mode: z.string(),
  status: z.string(),
  selected: z.array(z.string()),
  targets: z.array(z.string()),
  error: z.string().optional(),
});
const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
const labels: Record<string, string> = {
  passed: '成功',
  failed: '失敗',
  skipped: 'スキップ',
  blocked: 'ブロック',
  interrupted: '中断',
  flaky: '不安定',
  'timed-out': 'タイムアウト',
  cancelled: '取消',
  error: 'エラー',
};
const badge = (status: string) =>
  `<span class="badge ${status === 'passed' ? 'passed' : status === 'skipped' ? 'skipped' : 'failed'}">${Object.hasOwn(labels, status) ? labels[status] : '不明'}</span>`;
const seconds = (ms?: number) =>
  ms === undefined || !Number.isFinite(ms) ? '—' : `${(ms / 1000).toFixed(2)}秒`;

async function readJson(path: string) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024)
      throw new Error('レポートは20MiB以下の通常ファイルを指定してください。');
    return JSON.parse(await file.readFile('utf8')) as unknown;
  } finally {
    await file.close();
  }
}

async function artifactLink(output: string, path: string) {
  if (
    !path ||
    isAbsolute(path) ||
    win32.isAbsolute(path) ||
    /^[a-z][a-z\d+.-]*:/i.test(path) ||
    [...path].some(
      (char) => char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    ) ||
    path.split('/').some((part) => ['', '.', '..'].includes(part))
  )
    return null;
  if (
    !['.png', '.jpg', '.jpeg', '.webp', '.txt', '.md', '.json', '.webm', '.mp4'].includes(
      extname(path).toLowerCase(),
    )
  )
    return null;
  const file = join(output, 'results', path);
  try {
    const physical = await realpath(file);
    if (
      physical !== file ||
      !physical.startsWith(join(output, 'results') + sep) ||
      !(await lstat(file)).isFile()
    )
      return null;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return null;
    throw error;
  }
  return './results/' + path.split('/').map(encodeURIComponent).join('/');
}

/** report.jsonを変更せず、Git管理外の実行フォルダーへ静的HTMLを生成する。 */
export async function writeHtmlReport(directory: string, root = runsRoot) {
  const output = resolve(directory),
    base = resolve(root);
  const name = relative(base, output);
  if (
    !name ||
    name.startsWith('..') ||
    isAbsolute(name) ||
    name.includes(sep) ||
    (await realpath(output)) !== output
  )
    throw new Error('E2E実行フォルダーを指定してください。');
  const raw = await readJson(join(output, 'report.json'));
  const rawSummary = await readJson(join(output, 'run-summary.json'));
  if (raw === undefined && rawSummary === undefined)
    throw new Error('実行結果のJSONがありません。');
  const run = raw === undefined ? undefined : reportSchema.parse(raw).run;
  const context = rawSummary === undefined ? undefined : summarySchema.parse(rawSummary);
  const status =
    context?.status === 'failed' ? 'failed' : (run?.status ?? context?.status ?? 'failed');
  const selected = run?.results.filter((result) => result.selected) ?? [];
  let folders: string[] = [];
  try {
    folders = (await readdir(join(output, 'results'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const cases = await Promise.all(
    selected.map(async (result) => {
      const contents: string[] = [];
      const folder = folders.find(
        (folder) =>
          /^[a-f\d]{64}$/i.test(result.id) && folder.endsWith('-' + result.id.slice(0, 16)),
      );
      const trace = folder ? await artifactLink(output, `${folder}/trace.md`) : null;
      if (trace) contents.push(`<p><a href="${escape(trace)}">操作履歴（trace.md）</a></p>`);
      for (const [index, attempt] of result.attempts.entries()) {
        if (result.attempts.length > 1) contents.push(`<h3>試行 ${index + 1}</h3>`);
        if (attempt.error)
          contents.push(
            `<pre class="error">${escape(attempt.error.code)}\n${escape(attempt.error.message)}</pre>`,
          );
        const artifacts: string[] = [];
        for (const artifact of attempt.artifacts ?? []) {
          const href = await artifactLink(output, artifact.path);
          if (!href) continue;
          const image =
            artifact.kind === 'screenshot' && /\.(png|jpe?g|webp)$/i.test(artifact.path);
          artifacts.push(
            `<a href="${escape(href)}">${image ? 'スクリーンショット' : escape(artifact.kind)}を開く</a>${image ? `<img loading="lazy" src="${escape(href)}" alt="失敗時のスクリーンショット">` : ''}`,
          );
        }
        if (artifacts.length) contents.push(`<div class="artifacts">${artifacts.join('')}</div>`);
        if (attempt.steps?.length)
          contents.push(
            `<ol class="steps">${attempt.steps.map((step) => `<li>${badge(step.status)} <code>${escape(step.api)}</code> ${escape(step.label)} <small>${seconds(step.durationMs)}</small></li>`).join('')}</ol>`,
          );
      }
      const duration = result.attempts.length
        ? result.attempts.reduce((total, attempt) => total + (attempt.durationMs ?? 0), 0)
        : undefined;
      return `<details><summary>${badge(result.status)} <span class="case-title">${escape(result.titlePath.join(' › '))}</span><span class="target">${escape(result.targetId)}</span><small>${seconds(duration)}</small></summary><div class="details">${contents.join('') || '<p>記録された手順はありません。</p>'}</div></details>`;
    }),
  );
  const duration =
    run?.startedAt && run.finishedAt
      ? Date.parse(run.finishedAt) - Date.parse(run.startedAt)
      : undefined;
  const counts = run?.summary;
  const metrics = [
    ['成功', counts?.passed],
    ['失敗', counts?.failed],
    ['スキップ', counts?.skipped],
    ['所要時間', seconds(duration)],
    ['AI呼出（1操作の最大）', run?.usage?.maxModelCallsInStep],
    ['モデルトークン', run?.usage?.modelTokens],
  ];
  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>E2Eレポート · ${escape(name)}</title>
<style>
:root{font-family:system-ui,sans-serif;color:#23334f;background:#f2f6fc;line-height:1.65;color-scheme:light dark}*{box-sizing:border-box}body{max-width:1150px;margin:0 auto;padding:32px 20px 64px}h1{margin:4px 0 8px;font-size:1.8rem}h2{font-size:1.2rem;margin:28px 0 12px}h3{font-size:1rem}.meta,small{color:#61718a}.meta{overflow-wrap:anywhere}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:12px;margin:24px 0}.stat,details,.notice{background:#fff;border:1px solid #d7e1ee;border-radius:12px}.stat{padding:14px}.stat strong{display:block;font-size:1.4rem}details{margin:12px 0;overflow:hidden}summary{display:flex;align-items:center;gap:12px;padding:18px;cursor:pointer;flex-wrap:wrap}.case-title{flex:1;min-width:180px;overflow-wrap:anywhere}.badge{font-size:.8rem;padding:3px 10px;border-radius:20px;white-space:nowrap}.passed{background:#dff3e9;color:#195f42}.failed{background:#fde8e6;color:#9a302a}.skipped{background:#fff1cf;color:#765514}.target{font-size:.85rem;color:#61718a}.details{border-top:1px solid #e5ebf4;padding:18px}.notice{padding:16px}.error{background:#fff0ef;border:1px solid #f1c9c5;padding:16px;border-radius:8px}.steps{padding-left:24px}.steps li{padding:8px 0;border-bottom:1px solid #eaf0f7}pre,code{font-family:ui-monospace,monospace}pre,.steps li{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#315b96;text-underline-offset:3px}a:focus-visible,summary:focus-visible{outline:3px solid #4276b8;outline-offset:3px}.artifacts{display:grid;gap:12px;margin:16px 0}img{max-width:100%;height:auto;border:1px solid #d7e1ee;border-radius:8px}footer{margin-top:32px;font-size:.85rem;color:#61718a}@media(prefers-color-scheme:dark){:root{color:#d9e5f7;background:#121a29}.stat,details,.notice{background:#1c2940;border-color:#35465f}.meta,small,.target,footer{color:#acbad0}a{color:#9abdeb}.details,.steps li{border-color:#35465f}.error{background:#3e252b;border-color:#774b50}}@media(max-width:550px){body{padding:20px 12px}summary{gap:8px;padding:14px}.case-title{min-width:70%}.details{padding:14px}.stats{grid-template-columns:repeat(2,1fr)}}
</style></head><body><header><p class="meta">PUFU LENS · E2E</p><h1>ローカルE2Eレポート</h1>${badge(status)}<p class="meta">${escape(run?.id ?? name)}${context ? ` · モード ${escape(context.mode)}` : ''}<br>${escape(run?.startedAt ?? '開始日時の記録なし')}</p></header>
<section class="stats" aria-label="実行結果の概要">${metrics.map(([label, value]) => `<div class="stat">${escape(label)}<strong>${escape(value ?? '—')}</strong></div>`).join('')}</section>
${context?.error ? `<pre class="error">${escape(context.error)}</pre>` : ''}
${run?.errors?.map((error) => `<pre class="error">${escape(error.code)}\n${escape(error.message)}</pre>`).join('') ?? ''}
<h2>テスト結果</h2>${cases.join('') || '<p class="notice">個別のテスト結果はありません。起動や結果収集の段階で停止した可能性があります。</p>'}
<footer>${raw !== undefined ? '<a href="./report.json">元のJSONレポート</a> · ' : ''}${rawSummary !== undefined ? '<a href="./run-summary.json">実行情報</a> · ' : ''}HTMLはGit管理外の実行フォルダーに保存しています。結果は生成時点のものです。</footer></body></html>`;
  const destination = join(output, 'index.html');
  await writeGeneratedFile(destination, html);
  return destination;
}

async function writeGeneratedFile(destination: string, content: string) {
  try {
    const stat = await lstat(destination);
    if (!stat.isFile() || stat.nlink !== 1)
      throw new Error('レポートの出力先は通常ファイルにしてください。');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = join(dirname(destination), `.report-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** 実行前のエラーも記録し、HTML生成がテストの失敗を成功に変えないようにする。 */
export async function withHtmlReport(
  directory: string,
  info: { mode: string; selected: string[]; targets: string[]; url?: string },
  execute: () => Promise<void>,
  root = runsRoot,
) {
  const output = resolve(directory),
    base = resolve(root);
  const name = relative(base, output);
  if (!name || name.startsWith('..') || name.includes(sep) || isAbsolute(name))
    throw new Error('E2E実行フォルダーを指定してください。');
  await mkdir(output, { recursive: true });
  if ((await realpath(output)) !== output)
    throw new Error('実行フォルダーにsymlinkは使用できません。');
  let failed = false,
    failure: unknown;
  try {
    await execute();
  } catch (error) {
    failed = true;
    failure = error;
  }
  try {
    const summary = {
      ...info,
      status: failed ? 'failed' : 'passed',
      ...(failed
        ? {
            error: stripVTControlCharacters(
              failure instanceof Error ? failure.message : String(failure),
            ),
          }
        : {}),
    };
    await writeGeneratedFile(
      join(output, 'run-summary.json'),
      JSON.stringify(summary, null, 2) + '\n',
    );
    const html = await writeHtmlReport(output, root);
    console.log(`E2E HTMLレポート: ${html}`);
  } catch (error) {
    if (failed)
      throw new AggregateError([failure, error], 'E2E実行とHTMLレポート作成に失敗しました。');
    throw error;
  }
  if (failed) throw failure;
}

export async function reportDirectory(id?: string, root = runsRoot) {
  if (id !== undefined) {
    if (!/^[a-z\d][a-z\d_-]*$/i.test(id)) throw new Error('実行IDを指定してください。');
    return join(root, id);
  }
  const entries = await readdir(root, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        for (const filename of ['report.json', 'run-summary.json']) {
          try {
            const stat = await lstat(join(root, entry.name, filename));
            if (stat.isFile()) return { path: join(root, entry.name), time: stat.mtimeMs };
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
        return null;
      }),
  );
  const latest = candidates.filter((item) => item !== null).sort((a, b) => b.time - a.time)[0];
  if (!latest) throw new Error('保存済みのE2E実行結果がありません。');
  return latest.path;
}
