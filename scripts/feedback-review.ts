import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Operator-only CLI. Never load it into a Worker, browser bundle or MCP tool.
const { values } = parseArgs({
  options: {
    remote: { type: 'boolean', default: false },
    limit: { type: 'string', default: '20' },
  },
});
if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(values.limit!)) throw new Error('limitは1〜100です。');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const columns =
  'id,screen,category,status,hold_reason,title,summary,reproduction_steps,expected_behavior,actual_behavior,conversation,reasons,round,created_at,updated_at';
const sql = `SELECT ${columns} FROM usability_feedback WHERE review_status='unreviewed' ORDER BY created_at ASC LIMIT ${Number(values.limit)}`;
const args = [
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
  '--command',
  sql,
  '--json',
];
process.stdout.write(
  execFileSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 30000,
  }),
);
