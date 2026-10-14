import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigration, testApp } from './helpers';
import type { User } from '../shared/domain';
import { hash } from '../server/security';

describe('本人のプロフィール', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
  });
  afterEach(async () => {
    await app.dispose();
  });
  const update = (body: unknown, headers: Record<string, string> = {}) =>
    app.request('/api/v1/me', { method: 'PATCH', body, headers });
  const identity = async (user = 'alice') =>
    ((await (await app.request('/api/v1/me', { user })).json()) as { user: User }).user;

  it('名前・複数行の自己紹介を保存し、取得と別セッションに反映する', async () => {
    const previous = await identity();
    expect(previous.bio).toBe('');
    const updated = await update({
      name: '  新しい名前  ',
      bio: '  Webに興味があります。\n学んだことを記録します。  ',
    });
    expect(updated.status).toBe(200);
    const expected = {
      ...previous,
      name: '新しい名前',
      bio: 'Webに興味があります。\n学んだことを記録します。',
    };
    expect(((await updated.json()) as { user: User }).user).toEqual(expected);
    expect(await identity()).toEqual(expected);
    await app.env.DB.prepare(
      'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    )
      .bind(
        await hash('alice-other-session'),
        'alice',
        new Date(Date.now() + 86400000).toISOString(),
      )
      .run();
    const secondSession = await app.request('/api/v1/me', {
      headers: { Cookie: 'stock_session=alice-other-session' },
    });
    expect(((await secondSession.json()) as { user: User }).user).toEqual(expected);
    expect(await identity('bob')).toMatchObject({ name: 'Bob', bio: '' });
  });

  it('自己紹介を空に戻せる', async () => {
    await update({ name: 'Alice', bio: '自己紹介' });
    expect((await update({ name: 'Alice', bio: '' })).status).toBe(200);
    expect((await identity()).bio).toBe('');
  });

  it('文字数の上限を許可し、空白の名前・超過・不正な型を拒否する', async () => {
    const valid = { name: '名'.repeat(80), bio: '紹'.repeat(1000) };
    expect((await update(valid)).status).toBe(200);
    for (const body of [
      { name: '', bio: '' },
      { name: ' \n\t ', bio: '' },
      { name: '名'.repeat(81), bio: '' },
      { name: 'Alice', bio: '紹'.repeat(1001) },
      { name: null, bio: '' },
      { name: 'Alice', bio: null },
      { name: 'Alice' },
      { bio: '' },
    ])
      expect((await update(body)).status).toBe(400);
    expect(await identity()).toMatchObject(valid);
  });

  it('他ユーザーのID・Google識別子・メールの書き換えを拒否する', async () => {
    const before = await identity();
    for (const extra of [
      { id: 'bob' },
      { user_id: 'bob' },
      { google_sub: 'google-bob' },
      { email: 'another@example.com' },
    ])
      expect((await update({ name: '変更', bio: '変更', ...extra })).status).toBe(400);
    expect(await identity()).toEqual(before);
    expect(await identity('bob')).toMatchObject({ name: 'Bob', bio: '' });
  });

  it('未認証と別サイトからの更新を拒否する', async () => {
    const body = { name: '変更', bio: '変更' };
    expect((await update(body, { Cookie: '' })).status).toBe(401);
    expect((await update(body, { Origin: 'https://evil.example.com' })).status).toBe(403);
    expect((await identity()).name).toBe('Alice');
  });

  it('ショートカット用Bearerトークンでプロフィールを閲覧・更新できない', async () => {
    const created = await app.request('/api/v1/tokens', {
      method: 'POST',
      body: { name: 'iPhone', expires_days: null },
    });
    const { token } = (await created.json()) as { token: string };
    const headers = { Authorization: `Bearer ${token}`, Cookie: '', Origin: '' };
    expect((await app.request('/api/v1/me', { headers })).status).toBe(403);
    expect((await update({ name: '変更', bio: '' }, headers)).status).toBe(403);
    expect((await identity()).name).toBe('Alice');
  });

  it('移行時に既存ユーザー・セッション・プロジェクトを保持し、自己紹介を空で初期化する', async () => {
    await app.dispose();
    app = await testApp({ migrations: ['0001_initial.sql', '0002_unlimited_tokens.sql'] });
    const before = await app.env.DB.prepare('SELECT * FROM users ORDER BY id').all();
    const sessions = await app.env.DB.prepare('SELECT * FROM sessions ORDER BY user_id').all();
    const projects = await app.env.DB.prepare('SELECT * FROM projects ORDER BY id').all();
    await applyMigration(app.env.DB, '0003_user_profiles.sql');
    const after = await app.env.DB.prepare('SELECT * FROM users ORDER BY id').all();
    expect(after.results).toEqual(before.results.map((user) => ({ ...user, bio: '' })));
    expect(
      (await app.env.DB.prepare('SELECT * FROM sessions ORDER BY user_id').all()).results,
    ).toEqual(sessions.results);
    expect((await app.env.DB.prepare('SELECT * FROM projects ORDER BY id').all()).results).toEqual(
      projects.results,
    );
    expect(await identity()).toMatchObject({ name: 'Alice', bio: '' });
    expect((await update({ name: '移行後', bio: '自己紹介' })).status).toBe(200);
  });
});
