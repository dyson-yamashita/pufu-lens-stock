import { checkLedger } from './check.ts';
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { assertRunReport, executionMode, selectScenarios } from './policy.ts';
import { command, e2eBin, repo, saveJson, withRuntime, workspace } from './runtime.ts';

const { values } = parseArgs({
  options: {
    mode: { type: 'string' },
    target: { type: 'string' },
    scenario: { type: 'string' },
    related: { type: 'boolean' },
    base: { type: 'string', default: 'origin/main' },
  },
});
const mode = executionMode(values.mode, process.env.CI);
const targets = values.target ? [values.target] : ['desktop', 'phone'];
if (targets.some((target) => !['desktop', 'phone'].includes(target)))
  throw new Error('不明なE2Eターゲットです。');
const ledger = await checkLedger();
let selected = ledger.map(({ id }) => id);
if (values.related) {
  if (!values.base || !/^[A-Za-z0-9_./-]+$/.test(values.base) || values.base.startsWith('-'))
    throw new Error('不明な比較元です。');
  const base = execFileSync('git', ['merge-base', values.base, 'HEAD'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  const paths = execFileSync('git', ['diff', '--name-only', base], { cwd: repo, encoding: 'utf8' })
    .trim()
    .split('\n');
  paths.push(
    ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: repo,
      encoding: 'utf8',
    })
      .trim()
      .split('\n'),
  );
  selected = selectScenarios(ledger, paths);
}
if (values.scenario) {
  if (!selected.includes(values.scenario)) throw new Error('選択対象にないシナリオです。');
  selected = [values.scenario];
}
if (!selected.length) {
  console.log('変更箇所に対応するE2Eはありません。未実行（合格とは扱いません）。');
} else {
  const output = join(workspace, '.e2e/runs', randomUUID());
  await withRuntime(mode, async (url, env) => {
    const runnerEnv = { ...env, PUFU_E2E_OUTPUT: output };
    const args = [
      e2eBin,
      'run',
      '--config',
      'e2e.config.ts',
      '--target',
      targets.join(','),
      '--grep',
      `^(${selected.join('|')}) `,
    ];
    console.log(`E2E mode=${mode}, scenarios=${selected.join(',')}, targets=${targets.join(',')}`);
    try {
      const log = await command(args, runnerEnv, workspace);
      console.log(log);
      const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
      assertRunReport(report, selected, targets, mode);
      console.log('E2E report:', report.run.status, report.run.summary);
      await saveJson(join(output, 'run-summary.json'), {
        mode,
        url,
        selected,
        targets,
        status: report.run.status,
      });
    } catch (error) {
      await saveJson(join(output, 'run-summary.json'), {
        mode,
        url,
        selected,
        targets,
        status: 'failed',
      });
      console.error(`E2Eのレポートとトレース: ${output}`);
      throw error;
    }
  });
}
