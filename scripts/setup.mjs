import { copyFile, access } from 'node:fs/promises';

try {
  await access('.dev.vars');
  console.log('既存の .dev.vars を使用します。');
} catch {
  await copyFile('.dev.vars.example', '.dev.vars');
  console.log('ローカル専用の .dev.vars を作成しました。');
}
