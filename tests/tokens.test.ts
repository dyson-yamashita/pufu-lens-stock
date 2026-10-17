import { afterEach, describe, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { applyMigration, testApp } from './helpers';
import type { TokenInfo } from '../shared/domain';

describe('ショートカット用トークンの有効期間', () => {
  let app: Awaited<ReturnType<typeof testApp>> | undefined;
  afterEach(async () => {
    await app?.dispose();
  });

  it('無期限トークンで保存でき、プロジェクト制限と手動失効も有効', async () => {
    app = await testApp();
    const created = await app.request('/api/v1/tokens', {
      method: 'POST',
      body: { name: '無期限iPhone', project_id: 'alice-project', expires_days: null },
    });
    expect(created.status).toBe(201);
    const { id, token } = (await created.json()) as { id: string; token: string };
    const { tokens } = (await (await app.request('/api/v1/tokens')).json()) as {
      tokens: TokenInfo[];
    };
    expect(tokens.find((item) => item.id === id)?.expires_at).toBeNull();

    const headers = { Authorization: `Bearer ${token}`, Cookie: '', Origin: '' };
    const save = (project_id: string) =>
      app!.request('/api/v1/stocks', {
        method: 'POST',
        body: { project_id, url: 'https://example.com/unlimited' },
        headers,
      });
    expect((await save('alice-project')).status).toBe(202);
    expect((await save('alice-second')).status).toBe(403);
    expect((await app.request('/api/v1/tokens', { headers })).status).toBe(403);
    expect((await app.request(`/api/v1/tokens/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await save('alice-project')).status).toBe(401);
  });

  it('期限付きと省略時の90日は維持し、不正な期間は拒否する', async () => {
    app = await testApp();
    for (const [days, body] of [
      [30, { name: '30日', expires_days: 30 }],
      [90, { name: '既定値' }],
    ] as const) {
      const before = Date.now();
      const created = await app.request('/api/v1/tokens', { method: 'POST', body });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };
      const row = await app.env.DB.prepare('SELECT expires_at FROM api_tokens WHERE id = ?')
        .bind(id)
        .first<{ expires_at: string }>();
      const expiration = new Date(row!.expires_at).getTime();
      expect(expiration).toBeGreaterThanOrEqual(before + days * 86400000);
      expect(expiration).toBeLessThanOrEqual(Date.now() + days * 86400000);
    }
    for (const expires_days of [0, -1, 366, 1.5, 'unlimited', false]) {
      expect(
        (
          await app.request('/api/v1/tokens', {
            method: 'POST',
            body: { name: '不正な期間', expires_days },
          })
        ).status,
      ).toBe(400);
    }
  });

  it('無期限も20個の上限に数え、失効・期限切れ分は上限から除く', async () => {
    app = await testApp();
    const ids: string[] = [];
    for (let index = 0; index < 20; index++) {
      const created = await app.request('/api/v1/tokens', {
        method: 'POST',
        body: { name: `無期限${index}`, expires_days: null },
      });
      expect(created.status).toBe(201);
      ids.push(((await created.json()) as { id: string }).id);
    }
    const create = (expires_days: number | null) =>
      app!.request('/api/v1/tokens', {
        method: 'POST',
        body: { name: '追加', expires_days },
      });
    expect((await create(null)).status).toBe(422);
    expect((await create(30)).status).toBe(422);
    await app.request(`/api/v1/tokens/${ids[0]}`, { method: 'DELETE' });
    expect((await create(null)).status).toBe(201);
    await app.env.DB.prepare('UPDATE api_tokens SET expires_at = ? WHERE id = ?')
      .bind('2020-01-01T00:00:00.000Z', ids[1])
      .run();
    expect((await create(30)).status).toBe(201);
    expect((await create(null)).status).toBe(422);
  });

  it('移行時に既存トークンの全情報と認証・失効状態を保持する', async () => {
    app = await testApp({
      migrations: (await readdir(new URL('../migrations/', import.meta.url)))
        .filter((filename) => filename.endsWith('.sql') && filename !== '0002_unlimited_tokens.sql')
        .sort(),
    });
    const existing: { id: string; token: string }[] = [];
    for (const name of ['有効', '期限切れ', '失効済み']) {
      const created = await app.request('/api/v1/tokens', {
        method: 'POST',
        body: { name, project_id: 'alice-project', expires_days: 365 },
      });
      expect(created.status).toBe(201);
      existing.push((await created.json()) as { id: string; token: string });
    }
    await app.env.DB.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?')
      .bind('2026-01-01T00:00:00.000Z', existing[0].id)
      .run();
    await app.env.DB.prepare('UPDATE api_tokens SET expires_at = ? WHERE id = ?')
      .bind('2020-01-01T00:00:00.000Z', existing[1].id)
      .run();
    await app.request(`/api/v1/tokens/${existing[2].id}`, { method: 'DELETE' });
    const before = await app.env.DB.prepare('SELECT * FROM api_tokens ORDER BY id').all();
    await applyMigration(app.env.DB, '0002_unlimited_tokens.sql');
    const after = await app.env.DB.prepare('SELECT * FROM api_tokens ORDER BY id').all();
    expect(after.results).toEqual(before.results);

    for (const [index, item] of existing.entries()) {
      expect(
        (
          await app.request('/api/v1/projects', {
            headers: { Authorization: `Bearer ${item.token}`, Cookie: '', Origin: '' },
          })
        ).status,
      ).toBe(index === 0 ? 200 : 401);
    }
    expect(
      (
        await app.request('/api/v1/tokens', {
          method: 'POST',
          body: { name: '移行後の無期限', project_id: 'alice-project', expires_days: null },
        })
      ).status,
    ).toBe(201);
    await app.request('/api/v1/projects/alice-project', { method: 'DELETE' });
    expect(
      (await app.env.DB.prepare('SELECT COUNT(*) AS count FROM api_tokens').first<{
        count: number;
      }>())!.count,
    ).toBe(0);
  });
});
