import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLedger, runnerEnvironment } from './policy.ts';
import { command, repo, workspace, e2eBin } from './runtime.ts';

export async function checkLedger() {
  const input = JSON.parse(await readFile(join(workspace, 'scenarios.json'), 'utf8'));
  const output = await command(
    [e2eBin, 'list', '--config', 'e2e.config.ts', '--reporter', 'json'],
    {
      ...runnerEnvironment(process.env, 'ci'),
      // listはアプリ・ブラウザー・AIを起動しない。設定の構造検証用URL。
      PUFU_E2E_URL: 'http://127.0.0.1:12345',
    },
    workspace,
  );
  const paths = new Set<string>();
  for (const scenario of input) {
    for (const path of scenario.sources ?? []) {
      if (
        typeof path !== 'string' ||
        !/^(src|server|shared)\/[\w./-]+$/.test(path) ||
        path.split('/').includes('..')
      )
        throw new Error('E2E台帳のソースパスが不正です。');
      try {
        await access(join(repo, path));
        paths.add(path);
      } catch {
        /* validator reports the missing source. */
      }
    }
  }
  const ledger = validateLedger(input, JSON.parse(output).pairs, [...paths]);
  console.log(`E2E台帳: ${ledger.length}シナリオ × desktop/phone を照合しました。`);
  return ledger;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await checkLedger();
