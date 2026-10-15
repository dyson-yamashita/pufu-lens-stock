import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import type { Stock } from '../shared/domain';
import { applyMigration, testApp } from './helpers';

describe('ストックのお気に入り', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
  });
  afterEach(async () => {
    await app.dispose();
  });
  function fixture(
    id: string,
    options: {
      user?: string;
      project?: string;
      source?: 'url' | 'text';
      favorite?: boolean;
      title?: string;
    } = {},
  ) {
    const user = options.user ?? 'alice';
    return [
      app.env.DB.prepare(
        "INSERT INTO articles (id,user_id,canonical_url,source_url,title,domain,source_type,status) VALUES (?,?,?,?,?,'example.com',?,'ready')",
      ).bind(
        id,
        user,
        `https://example.com/${id}`,
        `https://example.com/${id}`,
        options.title ?? id,
        options.source ?? 'url',
      ),
      app.env.DB.prepare(
        "INSERT INTO stocks (id,user_id,project_id,article_id,note,created_at) VALUES (?,?,?,?,'ひとことメモ','2026-10-15T00:00:00.000Z')",
      ).bind(`stock-${id}`, user, options.project ?? `${user}-project`, id),
      ...(options.favorite
        ? [app.env.DB.prepare('UPDATE stocks SET is_favorite = 1 WHERE id = ?').bind(`stock-${id}`)]
        : []),
    ];
  }
  const favorite = (id: string, value: boolean, options = {}) =>
    app.request(`/api/v1/stocks/${id}/favorite`, {
      method: 'PATCH',
      body: { is_favorite: value },
      ...options,
    });
  async function list(params = '', user = 'alice') {
    const response = await app.request(`/api/v1/stocks${params}`, { user });
    expect(response.status).toBe(200);
    return (await response.json()) as { stocks: Stock[]; total: number };
  }

  it('URL・テキストを個別に登録・解除し、一覧と両方の詳細APIで保持する', async () => {
    await app.env.DB.batch([...fixture('web'), ...fixture('text', { source: 'text' })]);
    const original = (await list()).stocks;
    expect(original.every((stock) => stock.is_favorite === 0)).toBe(true);
    for (const stock of original) {
      expect(await (await favorite(stock.id, true)).json()).toEqual({
        id: stock.id,
        is_favorite: 1,
      });
      expect((await favorite(stock.id, true)).status).toBe(200);
      expect((await list()).stocks.find((item) => item.id === stock.id)).toEqual({
        ...stock,
        is_favorite: 1,
      });
      for (const path of [`/stocks/${stock.id}`, `/articles/${stock.article_id}`]) {
        const response = await app.request(`/api/v1${path}`);
        expect(response.status).toBe(200);
        expect(((await response.json()) as { stock: Stock }).stock).toEqual({
          ...stock,
          is_favorite: 1,
        });
      }
    }
    expect((await list('?favorite=true')).total).toBe(2);
    expect(await (await favorite('stock-web', false)).json()).toEqual({
      id: 'stock-web',
      is_favorite: 0,
    });
    expect((await list('?favorite=true')).stocks.map((stock) => stock.id)).toEqual(['stock-text']);
    expect((await list('?favorite=false')).total).toBe(2);
  });

  it('同じ記事でも別プロジェクトのストックや問いのお気に入りには影響しない', async () => {
    await app.env.DB.batch([
      ...fixture('shared'),
      app.env.DB.prepare(
        "INSERT INTO stocks (id,user_id,project_id,article_id) VALUES ('second','alice','alice-second','shared')",
      ),
      app.env.DB.prepare(
        "INSERT INTO questions (id,stock_id,source,text,status) VALUES ('question','stock-shared','user','問い？','ready')",
      ),
    ]);
    await favorite('stock-shared', true);
    expect((await list('?project_id=alice-second')).stocks[0].is_favorite).toBe(0);
    expect(
      (await app.env.DB.prepare('SELECT is_favorite FROM questions').first())!.is_favorite,
    ).toBe(0);
    expect((await list('?favorite=true')).stocks.map((stock) => stock.id)).toEqual([
      'stock-shared',
    ]);
    expect((await app.env.DB.prepare('SELECT COUNT(*) AS n FROM processing_jobs').first())!.n).toBe(
      0,
    );
  });

  it('作成元・プロジェクト・検索・状態と組み合わせ、他ユーザーを除外する', async () => {
    await app.env.DB.batch([
      ...fixture('web', { favorite: true, title: '100%の記事' }),
      ...fixture('text', { favorite: true, source: 'text', title: '100%の記録' }),
      ...fixture('second', { favorite: true, project: 'alice-second' }),
      ...fixture('normal'),
      ...fixture('bob', { favorite: true, user: 'bob' }),
    ]);
    expect((await list('?favorite=true')).total).toBe(3);
    expect((await list('?favorite=true&source=web')).total).toBe(2);
    expect((await list('?favorite=true&source=user')).stocks[0].id).toBe('stock-text');
    expect((await list('?favorite=true&project_id=alice-project&q=100%25')).total).toBe(2);
    expect((await list('?favorite=true&status=failed')).total).toBe(0);
    expect((await list('?favorite=true', 'bob')).stocks.map((stock) => stock.id)).toEqual([
      'stock-bob',
    ]);
    expect((await app.request('/api/v1/stocks?favorite=true&project_id=bob-project')).status).toBe(
      404,
    );
  });

  it('お気に入りだけをページ分割し、件数とページ間の重複が一致する', async () => {
    await app.env.DB.batch([
      ...Array.from({ length: 26 }, (_, i) =>
        fixture(`fav-${String(i).padStart(2, '0')}`, { favorite: true }),
      ).flat(),
      ...fixture('normal'),
    ]);
    const first = await list('?favorite=true&page=1');
    const second = await list('?favorite=true&page=2');
    expect(first.total).toBe(26);
    expect(second.total).toBe(26);
    expect(first.stocks).toHaveLength(24);
    expect(second.stocks).toHaveLength(2);
    expect(new Set([...first.stocks, ...second.stocks].map((stock) => stock.id)).size).toBe(26);
    expect([...first.stocks, ...second.stocks].every((stock) => stock.is_favorite === 1)).toBe(
      true,
    );
  });

  it('他ユーザー・未認証・別サイト・Bearerの変更と不正入力を拒否する', async () => {
    await app.env.DB.batch(fixture('owned'));
    expect((await favorite('stock-owned', true, { user: 'bob' })).status).toBe(404);
    expect((await favorite('missing', true)).status).toBe(404);
    expect((await favorite('stock-owned', true, { headers: { Cookie: '' } })).status).toBe(401);
    expect(
      (await favorite('stock-owned', true, { headers: { Origin: 'https://evil.example.com' } }))
        .status,
    ).toBe(403);
    const response = await app.request('/api/v1/tokens', {
      method: 'POST',
      body: { name: 'iPhone' },
    });
    const { token } = (await response.json()) as { token: string };
    expect(
      (await favorite('stock-owned', true, { headers: { Authorization: `Bearer ${token}` } }))
        .status,
    ).toBe(403);
    for (const body of [
      {},
      { is_favorite: 1 },
      { is_favorite: 'true' },
      { is_favorite: true, note: '' },
    ])
      expect(
        (await app.request('/api/v1/stocks/stock-owned/favorite', { method: 'PATCH', body }))
          .status,
      ).toBe(400);
    expect((await app.request('/api/v1/stocks?favorite=invalid')).status).toBe(400);
    expect((await list()).stocks[0].is_favorite).toBe(0);
  });

  it('再試行・メモ更新・移動で保持し、削除すると一覧から消える', async () => {
    await app.env.DB.batch(fixture('move'));
    await favorite('stock-move', true);
    await app.env.DB.prepare("UPDATE articles SET status = 'failed' WHERE id = 'move'").run();
    expect((await app.request('/api/v1/stocks/stock-move/retry', { method: 'POST' })).status).toBe(
      202,
    );
    expect((await list('?favorite=true')).stocks[0].is_favorite).toBe(1);
    expect(
      (
        await app.request('/api/v1/stocks/stock-move', {
          method: 'PATCH',
          body: { project_id: 'alice-second', note: '更新したメモ' },
        })
      ).status,
    ).toBe(200);
    expect((await list('?favorite=true&project_id=alice-second')).stocks[0]).toMatchObject({
      note: '更新したメモ',
      is_favorite: 1,
    });
    expect((await app.request('/api/v1/stocks/stock-move', { method: 'DELETE' })).status).toBe(200);
    expect((await list('?favorite=true')).total).toBe(0);
    expect((await favorite('stock-move', false)).status).toBe(404);
  });

  it('移行は既存ストックの内容を保持し、お気に入りを未選択にする', async () => {
    await app.dispose();
    const migrations = (await readdir(new URL('../migrations/', import.meta.url)))
      .filter((file) => file.endsWith('.sql') && file < '0010_stock_favorites.sql')
      .sort();
    app = await testApp({ migrations });
    await app.env.DB.batch([...fixture('old-web'), ...fixture('old-text', { source: 'text' })]);
    const before = await app.env.DB.prepare('SELECT * FROM stocks ORDER BY id').all();
    await applyMigration(app.env.DB, '0010_stock_favorites.sql');
    const after = await app.env.DB.prepare('SELECT * FROM stocks ORDER BY id').all();
    expect(after.results).toEqual(before.results.map((stock) => ({ ...stock, is_favorite: 0 })));
    expect((await list()).total).toBe(2);
    expect((await favorite('stock-old-web', true)).status).toBe(200);
  });
});
