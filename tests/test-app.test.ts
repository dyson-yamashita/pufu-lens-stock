import { Miniflare } from 'miniflare';
import { readdir } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { applyMigration, testApp } from './helpers';

it('高速な初期化もファイルごとの移行と同じテーブル・索引・トリガーと外部キーを用意する', async () => {
  const app = await testApp();
  const reference = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("reference"); } }',
    compatibilityDate: '2026-07-30',
    d1Databases: { DB: 'reference-database' },
  });
  try {
    const DB = (await reference.getD1Database('DB')) as unknown as D1Database;
    const files = (await readdir(new URL('../migrations/', import.meta.url)))
      .filter((filename) => filename.endsWith('.sql'))
      .sort();
    for (const filename of files) await applyMigration(DB, filename);
    const schema = async (db: D1Database) =>
      (
        await db
          .prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name')
          .all()
      ).results;
    expect(await schema(app.env.DB)).toEqual(await schema(DB));
    expect(await app.env.DB.prepare('PRAGMA foreign_keys').first('foreign_keys')).toBe(1);
    expect((await app.env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  } finally {
    await Promise.all([app.dispose(), reference.dispose()]);
  }
});

it('初期化を繰り返してもDB・R2・KVのデータを別環境へ引き継がない', async () => {
  const first = await testApp();
  let second: Awaited<ReturnType<typeof testApp>> | undefined;
  try {
    await first.env.DB.prepare("UPDATE users SET name='変更済み' WHERE id='alice'").run();
    await first.env.CONTENT.put('isolation-check', 'private content');
    await first.env.OAUTH_KV!.put('isolation-check', 'private token');
    second = await testApp();
    expect(
      await second.env.DB.prepare("SELECT name FROM users WHERE id='alice'").first('name'),
    ).toBe('Alice');
    expect(await second.env.CONTENT.get('isolation-check')).toBeNull();
    expect(await second.env.OAUTH_KV!.get('isolation-check')).toBeNull();
    expect(
      await first.env.DB.prepare("SELECT name FROM users WHERE id='alice'").first('name'),
    ).toBe('変更済み');
    expect(await first.env.OAUTH_KV!.get('isolation-check')).toBe('private token');
  } finally {
    await Promise.all([first.dispose(), second?.dispose()]);
  }
});

it('移行失敗を隠さず、失敗したファイル名を報告する', async () => {
  await expect(testApp({ migrations: ['0001_initial.sql', '0001_initial.sql'] })).rejects.toThrow(
    '0001_initial.sql',
  );
});
