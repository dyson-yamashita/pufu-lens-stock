import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArticleWorkflow, MemoryWorkflow } from '../server/workflows';
import type { Job } from '../server/env';
import type { Stock } from '../shared/domain';
import { applyMigration, mockEvent, mockStep, testApp } from './helpers';

describe('URLとテキストのストック', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
    app.env.LOCAL_DEMO_ENABLED = 'true';
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.dispose();
  });
  const text =
    '非同期処理の設計\n保存受付と要約の処理を分けると、通信が切れても処理を継続できます。\n再試行では同じ操作を重複して実行しない設計が必要です。';
  const save = (overrides = {}, headers = {}, user = 'alice') =>
    app.request('/api/v1/stocks', {
      method: 'POST',
      body: { type: 'text', text, project_id: 'alice-project', ...overrides },
      headers,
      user,
    });
  const detail = async (id: string) =>
    (await (await app.request(`/api/v1/stocks/${id}`)).json()) as { stock: Stock };
  async function run(kind: string, target?: string) {
    const job = await app.env.DB.prepare(
      'SELECT * FROM processing_jobs WHERE kind = ? AND (? IS NULL OR target_id = ?) ORDER BY revision DESC LIMIT 1',
    )
      .bind(kind, target ?? null, target ?? null)
      .first<Job>();
    expect(job).not.toBeNull();
    const workflow = ['article', 'question', 'cleanup'].includes(kind)
      ? new ArticleWorkflow(app.ctx, app.env)
      : new MemoryWorkflow(app.ctx, app.env);
    await workflow.run(mockEvent(job!.id), mockStep());
    return job!;
  }

  it('テキストを保存し、要約前から本人が本文を閲覧できる', async () => {
    const response = await save({ title: '  手入力のタイトル  ', text: ` \n${text}\n ` });
    expect(response.status).toBe(202);
    const { id } = (await response.json()) as { id: string };
    expect((await detail(id)).stock).toMatchObject({
      id,
      title: '手入力のタイトル',
      source_type: 'text',
      source_url: '',
      status: 'queued',
    });
    expect(await (await app.request(`/api/v1/stocks/${id}/content`)).json()).toEqual({
      content: text,
    });
    const list = (await (await app.request('/api/v1/stocks')).json()) as { stocks: Stock[] };
    expect(list.stocks[0].source_type).toBe('text');
    const article = (await (
      await app.request(`/api/v1/articles/${list.stocks[0].article_id}`)
    ).json()) as { stock: Stock };
    expect(article.stock.source_type).toBe('text');
    expect((await save({ text: 'タイトルのない本文です。' })).status).toBe(202);
    const auto = (await (await app.request('/api/v1/stocks')).json()) as { stocks: Stock[] };
    expect(auto.stocks.some((stock) => stock.title === 'タイトルのない本文です。')).toBe(true);
  });

  it('本文取得の通信をせずR2・要約・AIの問い・両方のメモリへつなぐ', async () => {
    const { id } = (await (await save()).json()) as { id: string };
    const fetchMock = vi.fn(async () => {
      throw new Error('テキストではURLへアクセスしてはいけません。');
    });
    vi.stubGlobal('fetch', fetchMock);
    const job = await run('article');
    expect(fetchMock).not.toHaveBeenCalled();
    const stock = (await detail(id)).stock;
    expect(stock.status).toBe('ready');
    expect(stock.summary?.keyPoints.length).toBeGreaterThan(0);
    expect(stock.title).toBe('非同期処理の設計');
    const body = await app.env.CONTENT.get(`alice/${job.target_id}/1.txt`);
    expect(await body!.text()).toBe(text);
    await run('question', id);
    const question = (await (await app.request(`/api/v1/stocks/${id}/question`)).json()) as {
      question: { source: string; status: string; text: string };
    };
    expect(question.question).toMatchObject({ source: 'ai', status: 'ready' });
    expect(question.question.text.length).toBeGreaterThan(0);
    for (const [kind, target] of [
      ['project_memory', 'alice-project'],
      ['user_memory', 'alice'],
    ])
      await run(kind, target);
    const memories = await app.env.DB.prepare('SELECT article_count, data_json FROM memories').all<{
      article_count: number;
      data_json: string;
    }>();
    expect(memories.results).toHaveLength(2);
    for (const memory of memories.results) {
      expect(memory.article_count).toBe(1);
      expect(JSON.parse(memory.data_json).knowledge[0].articleIds).toEqual([job.target_id]);
    }
  });

  it('同じテキストの再送・別プロジェクト保存・別ユーザー保存を扱う', async () => {
    const headers = { 'Idempotency-Key': 'text-request' };
    const { id } = (await (await save({}, headers)).json()) as { id: string };
    expect((await save({}, headers)).status).toBe(200);
    expect((await save({ text: '異なる本文' }, headers)).status).toBe(409);
    expect((await save({ title: '異なるタイトル' }, headers)).status).toBe(409);
    expect(
      (await save({ type: 'url', text: undefined, url: 'https://example.com' }, headers)).status,
    ).toBe(409);
    expect((await save()).status).toBe(200);
    expect((await save({ project_id: 'alice-second' })).status).toBe(202);
    expect((await save({ project_id: 'bob-project' }, {}, 'bob')).status).toBe(202);
    const count = await app.env.DB.prepare('SELECT COUNT(*) AS count FROM articles').first();
    expect(count!.count).toBe(2);
    expect((await detail(id)).stock.title).toBe('非同期処理の設計');
    expect(
      (await app.env.DB.prepare("SELECT memory_revision FROM users WHERE id = 'alice'").first())!
        .memory_revision,
    ).toBe(2);
  });

  it('日本語20,000文字を受け付け、空白・超過・混在した入力は拒否する', async () => {
    expect((await save({ text: 'あ'.repeat(20000) })).status).toBe(202);
    for (const overrides of [
      { text: '' },
      { text: ' \n\t ' },
      { text: 'あ'.repeat(20001) },
      { title: 'あ'.repeat(201) },
      { text: undefined },
      { type: 'unknown' },
      { url: 'https://example.com' },
      { type: 'url', url: 'https://example.com' },
      { type: undefined },
    ])
      expect((await save(overrides)).status).toBe(400);
    expect((await save({ text: 'あ'.repeat(100000) })).status).toBe(413);
  });

  it('認証・他ユーザーの閲覧・保存先・Bearerの制限を守る', async () => {
    expect((await save({}, { Cookie: '' })).status).toBe(401);
    expect((await save({}, { Origin: 'https://evil.example.com' })).status).toBe(403);
    expect((await save({ project_id: 'bob-project' })).status).toBe(404);
    const { id } = (await (await save()).json()) as { id: string };
    expect((await app.request(`/api/v1/stocks/${id}/content`, { user: 'bob' })).status).toBe(404);
    const { token } = (await (
      await app.request('/api/v1/tokens', {
        method: 'POST',
        body: { name: 'テキスト共有', project_id: 'alice-project' },
      })
    ).json()) as { token: string };
    const headers = { Cookie: '', Origin: '', Authorization: `Bearer ${token}` };
    expect((await save({ text: 'ショートカットからのテキストです。' }, headers)).status).toBe(202);
    expect((await save({ project_id: 'alice-second' }, headers)).status).toBe(403);
  });

  it('要約に失敗しても本文を保持し、再試行で回復できる', async () => {
    // 短文はAIなしで原文を使うため、AI要約が必要な長さの本文で障害を再現する。
    const longText = `${text}\n${text}`;
    const { id } = (await (await save({ text: longText })).json()) as { id: string };
    app.env.LOCAL_DEMO_ENABLED = 'false';
    await expect(run('article')).rejects.toThrow('Workers AI');
    expect((await detail(id)).stock.status).toBe('failed');
    expect(await (await app.request(`/api/v1/stocks/${id}/content`)).json()).toEqual({
      content: longText,
    });
    expect((await app.request(`/api/v1/stocks/${id}/retry`, { method: 'POST' })).status).toBe(202);
    app.env.LOCAL_DEMO_ENABLED = 'true';
    const job = await run('article');
    expect(job.revision).toBe(2);
    expect((await detail(id)).stock.status).toBe('ready');
    await run('cleanup');
    expect(await app.env.CONTENT.get(`alice/${job.target_id}/1.txt`)).toBeNull();
    expect(await (await app.env.CONTENT.get(`alice/${job.target_id}/2.txt`))!.text()).toBe(
      longText,
    );
  });

  it('ストック削除でテキストを除去し、問いを保持してR2本文を削除する', async () => {
    const { id } = (await (await save()).json()) as { id: string };
    const job = await run('article');
    await run('question', id);
    const questions = (await app.env.DB.prepare('SELECT * FROM questions ORDER BY id').all())
      .results;
    expect((await app.request(`/api/v1/stocks/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect(
      (await app.env.DB.prepare('SELECT COUNT(*) AS count FROM articles').first())!.count,
    ).toBe(0);
    expect((await app.env.DB.prepare('SELECT * FROM questions ORDER BY id').all()).results).toEqual(
      questions.map((question) => ({ ...question, stock_id: null })),
    );
    expect((await app.env.DB.prepare('SELECT * FROM question_stocks').all()).results).toEqual([]);
    await run('cleanup');
    expect(await app.env.CONTENT.get(`alice/${job.target_id}/1.txt`)).toBeNull();
  });

  it('既存記事の移行と従来のURL保存リクエストを保持する', async () => {
    await app.dispose();
    app = await testApp({
      migrations: [
        '0001_initial.sql',
        '0002_unlimited_tokens.sql',
        '0003_user_profiles.sql',
        '0004_stock_questions.sql',
        '0005_question_sources.sql',
        '0006_user_questions.sql',
      ],
    });
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO articles (id,user_id,canonical_url,source_url,title,domain,status) VALUES ('old','alice','https://example.com/old','https://example.com/old','既存記事','example.com','ready')",
      ),
      app.env.DB.prepare(
        "INSERT INTO stocks (id,user_id,project_id,article_id) VALUES ('old-stock','alice','alice-project','old')",
      ),
    ]);
    await applyMigration(app.env.DB, '0007_text_stocks.sql');
    await applyMigration(app.env.DB, '0010_stock_favorites.sql');
    await applyMigration(app.env.DB, '0011_question_deletion.sql');
    await applyMigration(app.env.DB, '0008_question_favorites.sql');
    await applyMigration(app.env.DB, '0009_pufu_scores.sql');
    await applyMigration(app.env.DB, '0012_pufu_phases.sql');
    await applyMigration(app.env.DB, '0016_independent_questions.sql');
    await applyMigration(app.env.DB, '0036_language.sql');
    expect((await detail('old-stock')).stock).toMatchObject({
      source_type: 'url',
      title: '既存記事',
      status: 'ready',
    });
    const response = await app.request('/api/v1/stocks', {
      method: 'POST',
      body: { project_id: 'alice-project', url: 'https://example.com/new' },
    });
    expect(response.status).toBe(202);
    const { id } = (await response.json()) as { id: string };
    expect((await detail(id)).stock.source_type).toBe('url');
  });
});
