import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';

const archive = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const root = fileURLToPath(new URL('../../', import.meta.url));
const bundle = join(root, `.ai-evaluation-${process.pid}.mjs`);
const scratch = mkdtempSync(join(tmpdir(), 'ai-evaluation-'));
const stripUUIDs = (value) => {
  if (Array.isArray(value)) return value.map(stripUUIDs);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'uuid')
        .map(([key, item]) => [key, stripUUIDs(item)]),
    );
  return value;
};
try {
  await build({
    entryPoints: [join(root, 'scripts/ai-evaluation/runner.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    outfile: bundle,
  });
  const fixtureFile = join(scratch, 'fixtures.json');
  writeFileSync(fixtureFile, JSON.stringify(archive.fixtures));
  for (const record of archive.records) {
    const directory = mkdtempSync(join(scratch, 'run-'));
    for (const [index, call] of record.calls.entries()) {
      assert.equal(call.index, index, 'Response indices must be sequential integers');
      writeFileSync(join(directory, `${index}.response.json`), JSON.stringify(call.response));
    }
    execFileSync(
      process.execPath,
      [bundle, fixtureFile, record.fixture, record.kind, record.profile, directory],
      { cwd: root, stdio: 'pipe' },
    );
    const final = JSON.parse(readFileSync(join(directory, 'final.json'), 'utf8'));
    assert.deepEqual(stripUUIDs(final), stripUUIDs(record.final), record.id);
  }
  console.log(`${archive.records.length} offline replays match ${basename(process.argv[2])}`);
} finally {
  rmSync(bundle, { force: true });
  rmSync(scratch, { recursive: true, force: true });
}
