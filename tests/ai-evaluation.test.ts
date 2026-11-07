import { it, expect } from 'vitest';
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

it('API失敗の再生でも入力改変を通常のAI失敗として一致扱いせず、致命エラーで停止する', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = join(root, `.ai-evaluation-${randomUUID()}.mjs`);
  const scratch = mkdtempSync(join(tmpdir(), 'ai-evaluation-test-'));
  try {
    await build({
      entryPoints: [join(root, 'scripts/ai-evaluation/runner.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      outfile: bundle,
    });
    const run = () =>
      spawnSync(
        process.execPath,
        [
          bundle,
          join(root, 'scripts/ai-evaluation/fixtures.json'),
          'conditions-ja',
          'summary',
          'baseline',
          scratch,
        ],
        { cwd: root, encoding: 'utf8' },
      );
    expect(run().status).toBe(75);
    const pending = JSON.parse(readFileSync(join(scratch, 'pending.json'), 'utf8'));
    const file = join(scratch, '0.response.json');
    writeFileSync(
      file,
      JSON.stringify({ requestHash: pending.requestHash, error: 'HTTP 429 (fixture)' }),
    );
    expect(run().status).toBe(0);
    const final = JSON.parse(readFileSync(join(scratch, 'final.json'), 'utf8'));
    expect(final).toMatchObject({ success: false, calls: 1 });
    expect(final.error).toContain('AI処理の応答を確認できませんでした');
    rmSync(join(scratch, 'final.json'));
    writeFileSync(file, JSON.stringify({ requestHash: 'tampered', error: 'HTTP 429 (fixture)' }));
    expect(run().status).toBe(76);
    expect(JSON.parse(readFileSync(join(scratch, 'fatal.json'), 'utf8'))).toEqual({
      error: 'Replay input mismatch',
      index: 0,
    });
  } finally {
    rmSync(bundle, { force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});
