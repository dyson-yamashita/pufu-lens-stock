import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArticleWorkflow, MemoryWorkflow } from '../server/infrastructure/jobs/workflows';
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
  const content = async (id: string) =>
    (await (await app.request(`/api/v1/stocks/${id}/content`)).json()) as {
      content: string;
      version: string;
    };
  const edit = (id: string, version: string, text: string, options = {}) =>
    app.request(`/api/v1/stocks/${id}/content`, {
      method: 'PATCH',
      body: { version, text },
      ...options,
    });
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
    expect(await content(id)).toEqual({ content: text, version: expect.any(String) });
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

  it('同じストックで本文・要約を更新し、タイトル・メモ・生成済みの問いを保持する', async () => {
    const { id } = (await (await save({ title: '元のタイトル', note: '元のメモ' })).json()) as {
      id: string;
    };
    const original = await run('article');
    await run('question', id);
    const question = await (await app.request(`/api/v1/stocks/${id}/question`)).json();
    const { version } = await content(id);
    const revised = '  編集済みの本文\n改行と空白を保持します。\n ';
    const response = await edit(id, version, revised);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(await content(id));
    expect(await content(id)).toEqual({ content: revised, version: expect.any(String) });
    expect((await detail(id)).stock).toMatchObject({
      id,
      article_id: original.target_id,
      title: '元のタイトル',
      project_id: 'alice-project',
      note: '元のメモ',
      summary: null,
    });
    const article = await app.env.DB.prepare('SELECT content_key FROM articles WHERE id = ?')
      .bind(original.target_id)
      .first();
    expect(article?.content_key).toBeNull();
    expect((await edit(id, version, revised)).status).toBe(200);
    const updated = await run('article', original.target_id);
    expect(updated.revision).toBe(original.revision + 1);
    expect((await detail(id)).stock.summary?.overview).toBe(revised.trim());
    expect(await (await app.request(`/api/v1/stocks/${id}/question`)).json()).toEqual(question);
    await run('cleanup');
    expect(await app.env.CONTENT.get(`alice/${original.target_id}/1.txt`)).toBeNull();
    expect(await (await app.env.CONTENT.get(`alice/${original.target_id}/2.txt`))!.text()).toBe(
      revised,
    );
  });

  it('非公開の保存先から編集しても、同じ文章を保存した公開先の原文は変わらない', async () => {
    const { id } = (await (await save({ skip_summary: true })).json()) as { id: string };
    const { id: publicStockId } = (await (
      await save({ skip_summary: true, project_id: 'alice-second' })
    ).json()) as { id: string };
    const original = await run('article');
    const searchEntry = (stockId: string) =>
      app.env.DB.prepare('SELECT id FROM stock_search_entries WHERE stock_id=? AND current=1')
        .bind(stockId)
        .first<string>('id');
    const originalEntry = await searchEntry(id);
    const publicEntry = await searchEntry(publicStockId);
    const { publication } = (await (
      await app.request('/api/v1/projects/alice-second/publication', {
        method: 'PATCH',
        body: { is_public: true, public_description: '' },
      })
    ).json()) as { publication: { public_id: string } };

    const before = await content(id);
    const revised = '\n  編集した非公開の原文。\n  ';
    expect((await edit(id, before.version, revised)).status).toBe(202);
    const updated = (await detail(id)).stock;
    expect(updated.article_id).not.toBe(original.target_id);
    expect(await searchEntry(id)).not.toBe(originalEntry);
    expect(await searchEntry(publicStockId)).toBe(publicEntry);
    await run('article', updated.article_id);
    expect((await detail(id)).stock.summary).toMatchObject({
      overview: revised,
      verbatim: true,
    });
    expect(await content(publicStockId)).toEqual(before);
    const response = await app.request(
      `/api/public/projects/${publication.public_id}/stocks/${publicStockId}`,
      { headers: { Cookie: '' } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      stock: { summary: { overview: text, verbatim: true } },
    });
  });

  it('要約前に編集でき、同じ版への並行編集は先に確定した本文を保持する', async () => {
    const { id } = (await (await save()).json()) as { id: string };
    const { version } = await content(id);
    const texts = ['並行編集した本文A', '並行編集した本文B'];
    const responses = await Promise.all(texts.map((text) => edit(id, version, text)));
    expect(responses.map((response) => response.status).sort()).toEqual([202, 409]);
    const revised = texts[responses.findIndex((response) => response.status === 202)];
    await run('article', (await detail(id)).stock.article_id);
    expect((await content(id)).content).toBe(revised);
    expect((await detail(id)).stock.summary?.overview).toBe(revised);
  });

  it('入力上限を検証し、他ユーザー・別サイト・URLストックからの編集を拒否する', async () => {
    const { id } = (await (await save()).json()) as { id: string };
    const { version } = await content(id);
    for (const invalid of [' \n\t ', 'あ'.repeat(20001)])
      expect((await edit(id, version, invalid)).status).toBe(400);
    expect((await edit(id, version, 'あ'.repeat(100000))).status).toBe(413);
    expect((await edit(id, version, '別の利用者', { user: 'bob' })).status).toBe(404);
    expect((await edit(id, version, '未認証', { headers: { Cookie: '' } })).status).toBe(401);
    expect(
      (await edit(id, version, '別サイト', { headers: { Origin: 'https://other.example.com' } }))
        .status,
    ).toBe(403);
    const { id: urlId } = (await (
      await app.request('/api/v1/stocks', {
        method: 'POST',
        body: { url: 'https://example.com', project_id: 'alice-project' },
      })
    ).json()) as { id: string };
    expect((await edit(urlId, version, 'URL記事の変更')).status).toBe(409);
    expect((await content(id)).content).toBe(text);
    const maxLength = 'あ'.repeat(20000);
    expect((await edit(id, version, maxLength)).status).toBe(202);
    expect((await content(id)).content).toBe(maxLength);
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
    expect((await content(id)).content).toBe(longText);
    expect(
      (
        await app.request(`/api/v1/stocks/${id}/retry`, {
          method: 'POST',
          body: { supplemental_text: 'テキストの本文は編集APIで変更する' },
        })
      ).status,
    ).toBe(400);
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
    await applyMigration(app.env.DB, '0053_stock_og_images.sql');
    expect((await detail('old-stock')).stock).toMatchObject({
      source_type: 'url',
      title: '既存記事',
      status: 'ready',
      has_og_image: 0,
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
