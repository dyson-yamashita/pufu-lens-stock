import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './helpers';
import { memorySaveStatement } from '../server/db';
import { hash } from '../server/security';

describe('認証と保存API（実際のSQLite）', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
  });
  afterEach(async () => {
    await app.dispose();
  });
  const save = (overrides = {}, headers = {}) =>
    app.request('/api/v1/stocks', {
      method: 'POST',
      body: { project_id: 'alice-project', url: 'https://example.com/article', ...overrides },
      headers,
    });
  it('未認証の保存を拒否する', async () => {
    expect((await save({}, { Cookie: '' })).status).toBe(401);
  });
  it('セッションによる他サイトからの変更を拒否する', async () => {
    expect((await save({}, { Origin: 'https://evil.example.com' })).status).toBe(403);
  });
  it('期限切れのセッションでは閲覧・保存できず、別ユーザーのセッションは有効', async () => {
    await app.env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?')
      .bind('2020-01-01T00:00:00.000Z', 'alice')
      .run();
    expect((await app.request('/api/v1/me')).status).toBe(401);
    expect((await save()).status).toBe(401);
    expect((await app.request('/api/v1/me', { user: 'bob' })).status).toBe(200);
  });
  it('別サイトからのログアウトを拒否し、ログアウト後は対象のセッションだけを無効にする', async () => {
    await app.env.DB.prepare(
      'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    )
      .bind(
        await hash('alice-other-session'),
        'alice',
        new Date(Date.now() + 86400000).toISOString(),
      )
      .run();
    expect(
      (
        await app.request('/api/v1/logout', {
          method: 'POST',
          headers: { Origin: 'https://evil.example.com' },
        })
      ).status,
    ).toBe(403);
    expect((await app.request('/api/v1/me')).status).toBe(200);
    const response = await app.request('/api/v1/logout', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toMatch(/stock_session=;.*Max-Age=0/i);
    expect((await app.request('/api/v1/me')).status).toBe(401);
    expect((await save()).status).toBe(401);
    expect(
      (
        await app.request('/api/v1/me', {
          headers: { Cookie: 'stock_session=alice-other-session' },
        })
      ).status,
    ).toBe(200);
    expect((await app.request('/api/v1/me', { user: 'bob' })).status).toBe(200);
  });
  it('他ユーザーのプロジェクトとメモリにアクセスできない', async () => {
    expect((await save({ project_id: 'bob-project' })).status).toBe(404);
    expect((await app.request('/api/v1/memory?project_id=bob-project')).status).toBe(404);
    const { projects } = (await (await app.request('/api/v1/projects')).json()) as {
      projects: { id: string }[];
    };
    expect(projects.map((p) => p.id)).not.toContain('bob-project');
  });
  it('プロジェクトを作成・編集・削除し、別プロジェクトに保存した同じ記事は保持する', async () => {
    const created = await app.request('/api/v1/projects', {
      method: 'POST',
      body: { name: '新しいプロジェクト', description: '最初の概要' },
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(
      (
        await app.request(`/api/v1/projects/${id}`, {
          method: 'PATCH',
          body: { name: '更新した名前', description: '更新した概要\n使える時間や予算' },
        })
      ).status,
    ).toBe(200);
    const { projects } = (await (await app.request('/api/v1/projects')).json()) as {
      projects: { id: string; name: string; description: string }[];
    };
    expect(projects.find((project) => project.id === id)).toMatchObject({
      name: '更新した名前',
      description: '更新した概要\n使える時間や予算',
    });
    const removedStock = (await (await save({ project_id: id })).json()) as { id: string };
    const keptStock = (await (await save()).json()) as { id: string };
    expect((await app.request(`/api/v1/projects/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/api/v1/stocks/${removedStock.id}`)).status).toBe(404);
    expect((await app.request(`/api/v1/stocks/${keptStock.id}`)).status).toBe(200);
    const remaining = (await (await app.request('/api/v1/projects')).json()) as {
      projects: { id: string }[];
    };
    expect(remaining.projects.map((project) => project.id)).not.toContain(id);
  });
  it.each(['PATCH', 'DELETE'])('他ユーザーのプロジェクトを%sで変更できない', async (method) => {
    const before = await (await app.request('/api/v1/projects', { user: 'bob' })).json();
    expect(
      (
        await app.request('/api/v1/projects/bob-project', {
          method,
          body: method === 'PATCH' ? { name: '変更を試みる', description: '' } : undefined,
        })
      ).status,
    ).toBe(404);
    expect(await (await app.request('/api/v1/projects', { user: 'bob' })).json()).toEqual(before);
  });
  it('受付、処理要求、メモリ更新要求を保存する', async () => {
    expect((await save()).status).toBe(202);
    const jobs = await app.env.DB.prepare('SELECT kind FROM processing_jobs').all<{
      kind: string;
    }>();
    expect(jobs.results.map((job) => job.kind).sort()).toEqual([
      'article',
      'project_memory',
      'user_memory',
    ]);
    expect(
      (await app.env.DB.prepare("SELECT memory_revision FROM users WHERE id = 'alice'").first<{
        memory_revision: number;
      }>())!.memory_revision,
    ).toBe(1);
  });
  it('追跡パラメータを除去し、同一プロジェクトでは二重保存しない', async () => {
    const first = (await (
      await save({ url: 'https://example.com/article?utm_source=ios#top' })
    ).json()) as { id: string };
    const duplicate = await save();
    expect(duplicate.status).toBe(200);
    expect(((await duplicate.json()) as { id: string }).id).toBe(first.id);
    expect(
      (await app.env.DB.prepare('SELECT COUNT(*) AS count FROM stocks').first<{ count: number }>())!
        .count,
    ).toBe(1);
    expect(
      (await app.env.DB.prepare("SELECT memory_revision FROM users WHERE id = 'alice'").first<{
        memory_revision: number;
      }>())!.memory_revision,
    ).toBe(1);
  });
  it('他のプロジェクトでは同じ記事本体を再利用する', async () => {
    await save();
    await save({ project_id: 'alice-second' });
    expect(
      (await app.env.DB.prepare('SELECT COUNT(*) AS count FROM articles').first<{
        count: number;
      }>())!.count,
    ).toBe(1);
    expect(
      (await app.env.DB.prepare('SELECT COUNT(*) AS count FROM stocks').first<{ count: number }>())!
        .count,
    ).toBe(2);
  });
  it('Idempotency-Keyの再送を再利用し、異なる内容を拒否する', async () => {
    const headers = { 'Idempotency-Key': 'request-1' };
    const first = (await (await save({}, headers)).json()) as { id: string };
    expect(((await (await save({}, headers)).json()) as { id: string }).id).toBe(first.id);
    expect((await save({ url: 'https://example.com/another' }, headers)).status).toBe(409);
  });
  it('同じキーで異なる内容が同時到着しても片方だけ保存する', async () => {
    const responses = await Promise.all([
      save({ url: 'https://example.com/first' }, { 'Idempotency-Key': 'race' }),
      save({ url: 'https://example.com/second' }, { 'Idempotency-Key': 'race' }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([202, 409]);
    expect(
      (await app.env.DB.prepare('SELECT COUNT(*) AS count FROM stocks').first<{ count: number }>())!
        .count,
    ).toBe(1);
  });
  it('Bearerトークンはハッシュで保存し、プロジェクトと操作を制限する', async () => {
    const created = await app.request('/api/v1/tokens', {
      method: 'POST',
      body: { name: 'iPhone', project_id: 'alice-project' },
    });
    const { token } = (await created.json()) as { token: string };
    const headers = { Authorization: `Bearer ${token}`, Cookie: '', Origin: '' };
    expect((await save({}, headers)).status).toBe(202);
    expect((await save({ project_id: 'alice-second' }, headers)).status).toBe(403);
    expect((await app.request('/api/v1/tokens', { headers })).status).toBe(403);
    const { projects } = (await (await app.request('/api/v1/projects', { headers })).json()) as {
      projects: { id: string }[];
    };
    expect(projects.map((p) => p.id)).toEqual(['alice-project']);
    const stored = await app.env.DB.prepare('SELECT token_hash FROM api_tokens').first<{
      token_hash: string;
    }>();
    expect(stored!.token_hash).toHaveLength(64);
    expect(stored!.token_hash).not.toBe(token);
  });
  it('失効・期限切れトークンを拒否し、Cookieへフォールバックしない', async () => {
    const { id, token } = (await (
      await app.request('/api/v1/tokens', { method: 'POST', body: { name: 'iPhone' } })
    ).json()) as { id: string; token: string };
    await app.env.DB.prepare('UPDATE api_tokens SET expires_at = ? WHERE id = ?')
      .bind('2020-01-01T00:00:00.000Z', id)
      .run();
    expect((await save({}, { Authorization: `Bearer ${token}` })).status).toBe(401);
    await app.request(`/api/v1/tokens/${id}`, { method: 'DELETE' });
    expect((await save({}, { Authorization: `Bearer ${token}` })).status).toBe(401);
  });
  it('他ユーザーの記事の閲覧・変更・削除を拒否する', async () => {
    const { id } = (await (await save()).json()) as { id: string };
    for (const [path, method] of [
      [`/api/v1/stocks/${id}/content`, 'GET'],
      [`/api/v1/stocks/${id}`, 'DELETE'],
      [`/api/v1/stocks/${id}/retry`, 'POST'],
    ])
      expect((await app.request(path, { method, user: 'bob' })).status).toBe(404);
  });
  it('最後の保存を削除すると本文の削除要求とメモリ更新が残る', async () => {
    const { id } = (await (await save({}, { 'Idempotency-Key': 'delete-request' })).json()) as {
      id: string;
    };
    await app.env.DB.prepare(
      "UPDATE articles SET content_key = 'alice/test/1.txt', status = 'ready' WHERE user_id = 'alice'",
    ).run();
    expect((await app.request(`/api/v1/stocks/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect(
      (await app.env.DB.prepare('SELECT COUNT(*) AS count FROM articles').first<{
        count: number;
      }>())!.count,
    ).toBe(0);
    expect(
      (await app.env.DB.prepare("SELECT kind FROM processing_jobs WHERE kind = 'cleanup'").first())!
        .kind,
    ).toBe('cleanup');
    expect((await save({}, { 'Idempotency-Key': 'delete-request' })).status).toBe(409);
  });
  it('古いメモリを保存しても新しい入力の版を上書きしない', async () => {
    await app.env.DB.prepare("UPDATE users SET memory_revision = 2 WHERE id = 'alice'").run();
    const input = {
      userId: 'alice',
      projectId: null,
      revision: 2,
      text: '最新',
      dataJson: '{}',
      articleCount: 2,
      model: 'test',
    };
    await memorySaveStatement(app.env, input).run();
    const stale = await memorySaveStatement(app.env, { ...input, revision: 1, text: '古い' }).run();
    expect(stale.meta.changes).toBe(0);
    expect(
      (await app.env.DB.prepare("SELECT text FROM memories WHERE user_id = 'alice'").first())!.text,
    ).toBe('最新');
  });
  it('公開ホストではデモログインを使えない', async () => {
    app.env.LOCAL_DEMO_ENABLED = 'true';
    expect(
      (
        await app.request('/api/auth/demo', {
          method: 'POST',
          host: 'https://production.example.com',
        })
      ).status,
    ).toBe(404);
    app.env.APP_URL = 'https://production.example.com';
    expect((await app.request('/api/auth/demo', { method: 'POST' })).status).toBe(404);
  });
  it('Google未設定と不正なOAuth callbackを安全に処理する', async () => {
    expect((await app.request('/api/auth/google')).status).toBe(503);
    const response = await app.request('/api/auth/google/callback?state=bad&code=bad');
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/?login_error=1');
  });
  it('ワイルドカードを含む検索語は文字列として扱う', async () => {
    await save();
    expect(
      ((await (await app.request('/api/v1/stocks?q=%25')).json()) as { total: number }).total,
    ).toBe(0);
  });
});
