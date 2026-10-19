import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Question, Stock } from '../shared/domain';
import { createApp } from '../server/api';
import { testApp } from './helpers';

describe('ストックのタイトル編集', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO articles (id,user_id,canonical_url,source_url,title,domain,source_type,status) VALUES ('web','alice','https://example.com','https://example.com','取得したタイトル','example.com','url','failed'), ('text','alice','text:sample','','テキストのタイトル','','text','ready')",
      ),
      app.env.DB.prepare(
        "INSERT INTO stocks (id,user_id,project_id,article_id,note) VALUES ('web-stock','alice','alice-project','web','元のメモ'), ('shared-stock','alice','alice-second','web',''), ('text-stock','alice','alice-project','text','')",
      ),
      app.env.DB.prepare(
        "INSERT INTO questions (id,stock_id,source,text,status) VALUES ('question','web-stock','user','記事の問い？','ready')",
      ),
    ]);
  });
  afterEach(async () => {
    await app.dispose();
  });
  const rename = (id: string, title: unknown, options = {}) =>
    app.request(`/api/v1/stocks/${id}/title`, {
      method: 'PATCH',
      body: { title },
      ...options,
    });
  const detail = async (id: string) =>
    ((await (await app.request(`/api/v1/stocks/${id}`)).json()) as { stock: Stock }).stock;

  it('URL・テキストの編集結果を保存し、一覧・詳細・問いと検索へ反映する', async () => {
    for (const id of ['web-stock', 'text-stock']) {
      expect(await (await rename(id, '  編集したタイトル100%  ')).json()).toEqual({
        id,
        title: '編集したタイトル100%',
      });
      expect((await detail(id)).title).toBe('編集したタイトル100%');
    }
    const list = (await (await app.request('/api/v1/stocks?q=編集したタイトル100%25')).json()) as {
      stocks: Stock[];
      total: number;
    };
    expect(list.total).toBe(2);
    expect(list.stocks.every((stock) => stock.title === '編集したタイトル100%')).toBe(true);
    const article = (await (await app.request('/api/v1/articles/text')).json()) as {
      stock: Stock;
    };
    expect(article.stock.title).toBe('編集したタイトル100%');
    const questions = (await (
      await app.request('/api/v1/questions?q=編集したタイトル100%25')
    ).json()) as { questions: Question[]; total: number };
    expect(questions.total).toBe(1);
    expect(questions.questions[0].article_title).toBe('編集したタイトル100%');
  });

  it('別ストックと記事本体を保持し、再取得・メモ更新・移動でも編集したタイトルを保持する', async () => {
    expect((await rename('web-stock', '自分用のタイトル')).status).toBe(200);
    expect((await detail('shared-stock')).title).toBe('取得したタイトル');
    expect((await detail('web-stock')).note).toBe('元のメモ');
    expect(
      (await app.env.DB.prepare("SELECT title FROM articles WHERE id = 'web'").first())!.title,
    ).toBe('取得したタイトル');
    expect((await app.env.DB.prepare('SELECT COUNT(*) AS n FROM processing_jobs').first())!.n).toBe(
      0,
    );
    await app.env.DB.prepare(
      "UPDATE articles SET title = '再取得したタイトル' WHERE id = 'web'",
    ).run();
    expect((await detail('web-stock')).title).toBe('自分用のタイトル');
    expect((await detail('shared-stock')).title).toBe('再取得したタイトル');
    expect((await app.request('/api/v1/stocks/shared-stock', { method: 'DELETE' })).status).toBe(
      200,
    );
    expect(
      (
        await app.request('/api/v1/stocks/web-stock', {
          method: 'PATCH',
          body: { note: '変更したメモ', project_id: 'alice-second' },
        })
      ).status,
    ).toBe(200);
    expect(await detail('web-stock')).toMatchObject({
      title: '自分用のタイトル',
      note: '変更したメモ',
      project_id: 'alice-second',
    });
  });

  it('コンパクト一覧と公開ページのストック・問いでも編集したタイトルを表示する', async () => {
    await rename('web-stock', '公開するタイトル');
    const compact = (await (
      await app.request('/api/v1/stocks?detail=compact&q=公開するタイトル')
    ).json()) as { stocks: { title: string }[]; total: number };
    expect(compact.total).toBe(1);
    expect(compact.stocks[0].title).toBe('公開するタイトル');
    const published = await app.request('/api/v1/projects/alice-project/publication', {
      method: 'PATCH',
      body: { is_public: true, public_description: '' },
    });
    expect(published.status).toBe(200);
    const { publication } = (await published.json()) as {
      publication: { public_id: string };
    };
    const get = async (path: string) => {
      const response = await app.request(`/api/public/projects/${publication.public_id}${path}`, {
        headers: { Cookie: '' },
      });
      expect(response.status).toBe(200);
      return response.json();
    };
    expect(await get('/stocks')).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: 'web-stock', title: '公開するタイトル' }),
      ]),
    });
    expect(await get('/stocks/web-stock')).toMatchObject({
      stock: { title: '公開するタイトル' },
      questions: [{ article_title: '公開するタイトル' }],
    });
    expect(await get('/questions')).toMatchObject({
      items: [{ article_title: '公開するタイトル' }],
    });
    expect(await get('/questions/question')).toMatchObject({
      question: { article_title: '公開するタイトル' },
      stock: { title: '公開するタイトル' },
    });
  });

  it('空白・文字数超過・型違い・余分な項目を拒否し、200文字まで保存する', async () => {
    for (const body of [
      {},
      { title: '' },
      { title: ' \n\t ' },
      { title: 'あ'.repeat(201) },
      { title: null },
      { title: 123 },
      { title: '変更', note: '上書き' },
    ]) {
      expect(
        (await app.request('/api/v1/stocks/web-stock/title', { method: 'PATCH', body })).status,
      ).toBe(400);
    }
    expect((await detail('web-stock')).title).toBe('取得したタイトル');
    expect((await rename('web-stock', 'あ'.repeat(200))).status).toBe(200);
    expect((await detail('web-stock')).title).toBe('あ'.repeat(200));
  });

  it('他ユーザー・未認証・別サイト・Bearerからの編集を拒否する', async () => {
    expect((await rename('web-stock', '変更', { user: 'bob' })).status).toBe(404);
    expect((await rename('missing', '変更')).status).toBe(404);
    expect((await rename('web-stock', '変更', { headers: { Cookie: '' } })).status).toBe(401);
    expect(
      (await rename('web-stock', '変更', { headers: { Origin: 'https://evil.example.com' } }))
        .status,
    ).toBe(403);
    const { token } = (await (
      await app.request('/api/v1/tokens', { method: 'POST', body: { name: 'iPhone' } })
    ).json()) as { token: string };
    expect(
      (await rename('web-stock', '変更', { headers: { Authorization: `Bearer ${token}` } })).status,
    ).toBe(403);
    const mcp = createApp({
      kind: 'mcp',
      tokenProjectId: null,
      user: { id: 'alice', name: 'Alice', email: 'alice@example.com', bio: '', avatar_url: null },
    });
    expect(
      (
        await mcp.request(
          `${app.env.APP_URL}/api/v1/stocks/web-stock/title`,
          { method: 'PATCH', body: JSON.stringify({ title: 'MCPからの変更' }) },
          app.env,
          app.ctx,
        )
      ).status,
    ).toBe(403);
    expect((await detail('web-stock')).title).toBe('取得したタイトル');
  });
});
