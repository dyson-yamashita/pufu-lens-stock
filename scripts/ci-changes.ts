import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { requiresApplicationValidation } from './change-scope.ts';

const [base, head] = process.argv.slice(2);
if (![base, head].every((ref) => typeof ref === 'string' && /^[a-f0-9]{40}$/.test(ref)))
  throw new Error('比較元と比較先の完全なコミットSHAが必要です。');
const mergeBase = execFileSync('git', ['merge-base', base, head], { encoding: 'utf8' }).trim();
// Disable rename detection so both the old and new paths participate in classification.
const paths = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', mergeBase, head], {
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);
const application = requiresApplicationValidation(paths);
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `application=${application}\n`);
console.log(
  application ? 'アプリ全体の検証を実施します。' : '通常の文書のみ：整形確認を実施します。',
);
