import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdir } from 'node:fs/promises';
import { applyMigration, testApp } from './helpers';
import { browserLanguage, languageSchema, resolveLanguage, translate } from '../shared/locale';

describe('言語の解決', () => {
  it('ブラウザーの主言語だけを使い、未対応・不正値は予測可能に解決する', () => {
    expect(['ja', 'ja-JP', 'JA-jp'].map(browserLanguage)).toEqual(['ja', 'ja', 'ja']);
    expect(['en-US', 'fr', '', ['ja'], null].map(browserLanguage)).toEqual([
      'en',
      'en',
      'en',
      'en',
      'en',
    ]);
    expect(resolveLanguage('en')).toBe('en');
    expect(resolveLanguage('en-US')).toBe('ja');
    expect(resolveLanguage(null, 'en')).toBe('en');
    expect(languageSchema.safeParse('fr').success).toBe(false);
    expect(translate('en', 'memory.interest', { topic: 'Design', count: 2 })).toBe(
      'Collected 2 articles about “Design”.',
    );
    expect(translate('en', 'Unknown message')).toBe('Unknown message');
  });
});

describe('アカウントの言語', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  afterEach(async () => app?.dispose());
  const profile = (language?: unknown) =>
    app.request('/api/v1/me', {
      method: 'PATCH',
      body: { name: 'Alice', bio: '', ...(language === undefined ? {} : { language }) },
    });

  it('初回登録の言語を保存し、省略した登録は日本語にする', async () => {
    app = await testApp({ onboarding: false });
    const acceptance = {
      name: 'Alice',
      terms_accepted: true,
      privacy_accepted: true,
      terms_version: '2026-10-30',
      privacy_version: '2026-10-30',
    };
    expect(
      (
        await app.request('/api/v1/onboarding', {
          method: 'POST',
          body: { ...acceptance, language: 'fr' },
        })
      ).status,
    ).toBe(400);
    const saved = await app.request('/api/v1/onboarding', {
      method: 'POST',
      body: { ...acceptance, language: 'en' },
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ user: { language: 'en' } });
    const bob = await app.request('/api/v1/onboarding', {
      method: 'POST',
      body: acceptance,
      user: 'bob',
    });
    expect(await bob.json()).toMatchObject({ user: { language: 'ja' } });
  });

  it('言語のみの変更は他アカウント・既存コンテンツ・世代・ジョブへ影響せず、省略は保持する', async () => {
    app = await testApp();
    const run = vi.fn(async () => ({ response: {} }));
    app.env.AI = { run };
    const before = (await app.env.DB.prepare('SELECT * FROM projects ORDER BY id').all()).results;
    expect((await profile('en')).status).toBe(200);
    expect(await (await profile()).json()).toMatchObject({ user: { language: 'en' } });
    expect(await (await app.request('/api/v1/me')).json()).toMatchObject({
      user: { language: 'en' },
    });
    expect(await (await app.request('/api/v1/me', { user: 'bob' })).json()).toMatchObject({
      user: { language: 'ja' },
    });
    expect((await app.env.DB.prepare('SELECT memory_revision FROM users').all()).results).toEqual([
      { memory_revision: 0 },
      { memory_revision: 0 },
    ]);
    expect((await app.env.DB.prepare('SELECT * FROM processing_jobs').all()).results).toEqual([]);
    expect((await app.env.DB.prepare('SELECT * FROM projects ORDER BY id').all()).results).toEqual(
      before,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it.each(['fr', 'en-US', '', null, ['en']])(
    '未対応のプロフィール言語を変更前に拒否する: %j',
    async (language) => {
      app = await testApp();
      expect((await profile(language)).status).toBe(400);
      expect(await (await app.request('/api/v1/me')).json()).toMatchObject({
        user: { name: 'Alice', language: 'ja' },
      });
    },
  );

  it('すべての登録経路でユーザー言語を原子的に固定し、明示した親言語を保持する', async () => {
    app = await testApp();
    await profile('en');
    await app.env.DB.batch(
      ['article', 'question', 'pufu', 'project_memory', 'user_memory', 'cleanup'].map((kind) =>
        app.env.DB.prepare(
          'INSERT INTO processing_jobs(id,user_id,kind,target_id,revision) VALUES(?,?,?,?,1)',
        ).bind(kind, 'alice', kind, 'target'),
      ),
    );
    await profile('ja');
    expect(
      (await app.env.DB.prepare('SELECT language FROM processing_jobs').all()).results,
    ).toEqual(Array(6).fill({ language: 'en' }));
    await app.env.DB.prepare(
      "INSERT INTO processing_jobs(id,user_id,kind,target_id,revision,language) VALUES('child','alice','question','target',2,'en')",
    ).run();
    expect(
      await app.env.DB.prepare("SELECT language FROM processing_jobs WHERE id='child'").first(),
    ).toEqual({ language: 'en' });
  });

  it('自己紹介と同時に変更した言語をそのメモリ要求へ固定する', async () => {
    app = await testApp();
    expect(
      (
        await app.request('/api/v1/me', {
          method: 'PATCH',
          body: { name: 'Alice', bio: 'Changed context.', language: 'en' },
        })
      ).status,
    ).toBe(200);
    expect(
      await app.env.DB.prepare(
        "SELECT language FROM processing_jobs WHERE kind='user_memory'",
      ).first(),
    ).toEqual({ language: 'en' });
  });

  it('既存スキーマを移行し、日本語を補完して既存データを保持する', async () => {
    const migrations = (await readdir(new URL('../migrations/', import.meta.url)))
      .filter((name) => name.endsWith('.sql') && name < '0036')
      .sort();
    app = await testApp({ migrations, languageMigration: false });
    await app.env.DB.prepare(
      "INSERT INTO processing_jobs(id,user_id,kind,target_id,revision) VALUES('old','alice','article','saved',1)",
    ).run();
    await app.env.DB.prepare(
      "INSERT INTO memories(id,user_id,project_id,revision,text,data_json,article_count,model) VALUES('project-alice-project','alice','alice-project',0,'以前のメモリ','{\"knowledge\":[]}',0,'old')",
    ).run();
    const users = (await app.env.DB.prepare('SELECT * FROM users ORDER BY id').all()).results;
    const memory = await app.env.DB.prepare('SELECT * FROM memories').first();
    await applyMigration(app.env.DB, '0036_language.sql');
    expect((await app.env.DB.prepare('SELECT * FROM users ORDER BY id').all()).results).toEqual(
      users.map((user) => ({ ...user, language: 'ja' })),
    );
    expect(
      await app.env.DB.prepare(
        "SELECT target_id,revision,language FROM processing_jobs WHERE id='old'",
      ).first(),
    ).toEqual({ target_id: 'saved', revision: 1, language: 'ja' });
    expect(await app.env.DB.prepare('SELECT * FROM memories').first()).toEqual({
      ...memory,
      language: 'ja',
    });
  });
});
