import { announcementRegistrationSql } from './announcement-input.ts';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { announcementSchema } from '../shared/announcements.ts';

// Operator-only: this command has no browser/API/MCP entry point.
const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    remote: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
});
if (!values.file) throw new Error('--fileで登録内容のJSONを指定してください。');
if (statSync(values.file).size > 65536) throw new Error('JSONは64KiB以内です。');
const item = announcementSchema.parse(JSON.parse(readFileSync(values.file, 'utf8')));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sql = announcementRegistrationSql(item);
console.log(
  JSON.stringify({
    target: values.remote ? 'production' : 'local',
    id: item.id,
    publishedAt: item.publishedAt,
    notify: item.notify,
    notifyAt: item.notifyAt,
    dryRun: values['dry-run'],
  }),
);
if (!values['dry-run']) {
  const temp = mkdtempSync(join(tmpdir(), 'pufu-announcement-'));
  try {
    const file = join(temp, 'announcement.sql');
    writeFileSync(file, sql, { mode: 0o600 });
    execFileSync(
      process.execPath,
      [
        resolve(root, 'node_modules/wrangler/bin/wrangler.js'),
        'd1',
        'execute',
        'stock-db',
        ...(values.remote
          ? [
              '--remote',
              '--env',
              'production',
              '--config',
              resolve(root, 'dist/pufu_lens_stock/wrangler.json'),
            ]
          : ['--local']),
        '--file',
        file,
      ],
      { cwd: root, stdio: 'inherit', timeout: 30000 },
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
