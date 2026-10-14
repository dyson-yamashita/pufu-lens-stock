import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Stock } from '../shared/domain';
import { testApp } from './helpers';

describe('ストックのweb／ユーザーフィルター', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
  });
  afterEach(async () => {
    await app.dispose();
  });
  function fixture(
    id: string,
    source: 'url' | 'text',
    options: { user?: string; project?: string; title?: string; status?: string } = {},
  ) {
    const user = options.user ?? 'alice';
    const project = options.project ?? `${user}-project`;
    return [
      app.env.DB.prepare(
        'INSERT INTO articles (id,user_id,canonical_url,source_url,title,domain,source_type,status) VALUES (?,?,?,?,?,?,?,?)',
      ).bind(
        id,
        user,
        `${source}:${id}`,
        source === 'url' ? `https://example.com/${id}` : '',
        options.title ?? id,
        source === 'url' ? 'example.com' : '',
        source,
        options.status ?? 'ready',
      ),
      app.env.DB.prepare(
        "INSERT INTO stocks (id,user_id,project_id,article_id,created_at) VALUES (?,?,?,?, '2026-10-15T00:00:00.000Z')",
      ).bind(`stock-${id}`, user, project, id),
    ];
  }
  async function list(params = '', user = 'alice') {
    const response = await app.request(`/api/v1/stocks${params}`, { user });
    expect(response.status).toBe(200);
    return (await response.json()) as { stocks: Stock[]; total: number };
  }

  it('状態によらずwebはURL、ユーザーはテキストを返し、他ユーザーのデータを含めない', async () => {
    await app.env.DB.batch([
      ...fixture('web-ready', 'url'),
      ...fixture('web-queued', 'url', { status: 'queued' }),
      ...fixture('user-failed', 'text', { status: 'failed' }),
      ...fixture('bob-text', 'text', { user: 'bob' }),
    ]);
    expect((await list()).total).toBe(3);
    const web = await list('?source=web');
    expect(web.total).toBe(2);
    expect(web.stocks.map((stock) => stock.source_type)).toEqual(['url', 'url']);
    const manual = await list('?source=user');
    expect(manual.total).toBe(1);
    expect(manual.stocks[0]).toMatchObject({ article_id: 'user-failed', source_type: 'text' });
    expect((await list('?source=user', 'bob')).stocks[0].article_id).toBe('bob-text');
    expect((await list('?source=user&status=failed')).total).toBe(1);
    expect((await list('?source=user&status=ready')).total).toBe(0);
  });

  it('作成元・プロジェクト・検索語を組み合わせて件数と一覧を絞り込む', async () => {
    await app.env.DB.batch([
      ...fixture('first-text', 'text', { title: '100%の記録' }),
      ...fixture('first-web', 'url', { title: '100%の記事' }),
      ...fixture('second-text', 'text', { project: 'alice-second', title: '100%の記録' }),
      ...fixture('literal-text', 'text', { title: '100パーセントの記録' }),
    ]);
    const result = await list('?source=user&project_id=alice-project&q=100%25');
    expect(result.total).toBe(1);
    expect(result.stocks.map((stock) => stock.article_id)).toEqual(['first-text']);
    expect((await list('?source=web&project_id=alice-second')).total).toBe(0);
    expect((await list('?source=user&project_id=alice-second')).total).toBe(1);
  });

  it('絞り込み後にページ分割し、総件数とページ間の重複が一致する', async () => {
    const statements: D1PreparedStatement[] = [];
    for (let index = 0; index < 26; index++)
      statements.push(...fixture(`text-${String(index).padStart(2, '0')}`, 'text'));
    for (let index = 0; index < 5; index++) statements.push(...fixture(`web-${index}`, 'url'));
    await app.env.DB.batch(statements);
    const first = await list('?source=user&page=1');
    const second = await list('?source=user&page=2');
    expect(first.total).toBe(26);
    expect(second.total).toBe(26);
    expect(first.stocks).toHaveLength(24);
    expect(second.stocks).toHaveLength(2);
    const ids = [...first.stocks, ...second.stocks].map((stock) => stock.id);
    expect(new Set(ids).size).toBe(26);
    expect([...first.stocks, ...second.stocks].every((stock) => stock.source_type === 'text')).toBe(
      true,
    );
    expect((await list('?source=web')).total).toBe(5);
  });

  it('不正な作成元と他ユーザーの保存先、未認証の閲覧を拒否する', async () => {
    for (const source of ['unknown', 'url', 'text', 'ai'])
      expect((await app.request(`/api/v1/stocks?source=${source}`)).status).toBe(400);
    expect((await app.request('/api/v1/stocks?source=user&project_id=bob-project')).status).toBe(
      404,
    );
    expect(
      (await app.request('/api/v1/stocks?source=web', { headers: { Cookie: '' } })).status,
    ).toBe(401);
  });
});
