import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArticleWorkflow, MemoryWorkflow } from '../server/infrastructure/jobs/workflows';
import type { Job } from '../server/env';
import type { Stock } from '../shared/domain';
import { createApp } from '../server/api/app';
import { applyMigration, mockEvent, mockStep, pauseOperation, testApp } from './helpers';
import { legacyQuestionStatements } from './legacy-questions-fixture';
import { articleSummaryPaths } from './models/article-summary';

const summaryCases = articleSummaryPaths.map(({ steps }) => {
  const operations = steps.slice(1);
  return { name: operations.map(({ event }) => event.type).join(' → '), operations };
});

it('B08 MBTは新旧どちらの完了順でも新しいジョブの再配送まで通す', () => {
  expect(summaryCases.map(({ name }) => name).sort()).toEqual([
    'editText → completeCurrent → completeOriginal → redeliverCurrent',
    'editText → completeOriginal → completeCurrent → redeliverCurrent',
  ]);
});

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
  async function run(kind: string, target?: string, step = mockStep()) {
    const job = await app.env.DB.prepare(
      'SELECT * FROM processing_jobs WHERE kind = ? AND (? IS NULL OR target_id = ?) ORDER BY revision DESC LIMIT 1',
    )
      .bind(kind, target ?? null, target ?? null)
      .first<Job>();
    expect(job).not.toBeNull();
    const workflow = ['article', 'question', 'cleanup'].includes(kind)
      ? new ArticleWorkflow(app.ctx, app.env)
      : new MemoryWorkflow(app.ctx, app.env);
    await workflow.run(mockEvent(job!.id), step);
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

  it('本文取得の通信をせずR2・要約・両方のメモリへつなぐ', async () => {
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
    expect(await (await app.request(`/api/v1/stocks/${id}/question`)).json()).toMatchObject({
      question: null,
      questions: [],
    });
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
    await app.env.DB.batch(legacyQuestionStatements(app.env, id));
    await run('question', id);
    const question = await (await app.request(`/api/v1/stocks/${id}/question`)).json();
    const { version } = await content(id);
    const revised = '  編集済みの本文\n改行と空白を保持します。\n ';
    const response = await edit(id, version, revised);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(await content(id));
    expect(await content(id)).toEqual({ content: revised, version: expect.any(String) });
    const duplicate = await save({ title: '元のタイトル', text: revised });
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ id, duplicate: true });
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
    const { token } = (await (
      await app.request('/api/v1/tokens', {
        method: 'POST',
        body: { name: '別の保存先', project_id: 'alice-second' },
      })
    ).json()) as { token: string };
    const scopedSave = await save(
      { title: '非同期処理の設計', text: revised, skip_summary: true, project_id: 'alice-second' },
      { Authorization: `Bearer ${token}`, Cookie: '', Origin: '' },
    );
    expect(scopedSave.status).toBe(202);
    expect(await scopedSave.json()).toMatchObject({ duplicate: false, status: 'queued' });
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
    const existing = await save({ title: '非同期処理の設計', text: revised });
    expect(existing.status).toBe(200);
    expect(await existing.json()).toMatchObject({ id, duplicate: true });
    expect((await edit(id, (await content(id)).version, text)).status).toBe(202);
    expect(await (await save()).json()).toMatchObject({ id, duplicate: true });
  });

  it.each(summaryCases)('B08 MBT $name', async ({ operations }) => {
    const saved = await save();
    expect(saved.status).toBe(202);
    const { id } = (await saved.json()) as { id: string };
    const { version } = await content(id);
    const { article_id: articleId } = (await detail(id)).stock;
    // 旧データの待機中の問いを残し、新しい要約だけが問いを予約できる状態にする。
    await app.env.DB.batch(legacyQuestionStatements(app.env, id));
    const revised = '要約の確定前に編集した本文';
    const memoryRevisions = async () =>
      (
        await app.env.DB.batch<{ memory_revision: number }>([
          app.env.DB.prepare("SELECT memory_revision FROM projects WHERE id='alice-project'"),
          app.env.DB.prepare("SELECT memory_revision FROM users WHERE id='alice'"),
        ])
      ).map(({ results }) => results[0].memory_revision);
    const [projectRevision, userRevision] = await memoryRevisions();
    const followUpJobs = async () =>
      (
        await app.env.DB.prepare(
          "SELECT kind,target_id,revision FROM processing_jobs WHERE kind IN ('project_memory','question','user_memory')",
        ).all<Pick<Job, 'kind' | 'target_id' | 'revision'>>()
      ).results;
    const previousJobs = await followUpJobs();
    expect(previousJobs.some(({ kind }) => kind === 'question')).toBe(false);
    const commit = pauseOperation<void>('旧要約のcommit-summary');
    const original = run(
      'article',
      articleId,
      mockStep(undefined, async (name) => {
        if (name === 'commit-summary') await commit.pause();
      }),
    );
    let currentJobId: string | null = null;
    const runCurrent = async () => {
      expect(currentJobId).not.toBeNull();
      await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(currentJobId!), mockStep());
    };
    const execute = {
      editText: async () => {
        expect((await edit(id, version, revised)).status).toBe(202);
        currentJobId = await app.env.DB.prepare(
          "SELECT id FROM processing_jobs WHERE kind='article' AND target_id=? AND revision=2",
        )
          .bind(articleId)
          .first<string>('id');
        expect(currentJobId).toEqual(expect.any(String));
      },
      completeOriginal: async () => {
        commit.resume();
        await original;
      },
      completeCurrent: runCurrent,
      redeliverCurrent: runCurrent,
    };
    try {
      await commit.waitForPause(original);
      for (const { event, state } of operations) {
        await execute[event.type]();
        const ready = state.hasTag('summaryReady');
        const revisionIncrement = ready ? 2 : 1;
        const article = await app.env.DB.prepare(
          'SELECT generation,content_key FROM articles WHERE id=?',
        )
          .bind(articleId)
          .first<{ generation: number; content_key: string | null }>();
        expect(article).toMatchObject({ generation: 2 });
        expect((await content(id)).content).toBe(revised);
        expect((await detail(id)).stock).toMatchObject({
          article_id: articleId,
          status: ready ? 'ready' : 'queued',
          summary: ready ? { overview: revised } : null,
        });
        if (ready) {
          expect(article?.content_key).toEqual(expect.any(String));
          const stored = await app.env.CONTENT.get(article!.content_key!);
          expect(await stored?.text()).toBe(revised);
        } else expect(article?.content_key).toBeNull();
        expect(await memoryRevisions()).toEqual([
          projectRevision + revisionIncrement,
          userRevision + revisionIncrement,
        ]);
        const expectedJobs = [
          ...previousJobs,
          ...(ready
            ? [
                {
                  kind: 'project_memory',
                  target_id: 'alice-project',
                  revision: projectRevision + 2,
                },
                { kind: 'question', target_id: id, revision: 2 },
                { kind: 'user_memory', target_id: 'alice', revision: userRevision + 2 },
              ]
            : []),
        ];
        const jobs = await followUpJobs();
        expect(jobs, event.type).toHaveLength(expectedJobs.length);
        expect(jobs, event.type).toEqual(expect.arrayContaining(expectedJobs));
        const articleJobs = await app.env.DB.prepare(
          "SELECT id,revision,status FROM processing_jobs WHERE kind='article' AND target_id=? ORDER BY revision",
        )
          .bind(articleId)
          .all<Pick<Job, 'id' | 'revision' | 'status'>>();
        expect(articleJobs.results, event.type).toMatchObject([
          { revision: 1, status: state.hasTag('originalFinished') ? 'done' : 'running' },
          { id: currentJobId, revision: 2, status: ready ? 'done' : 'dispatched' },
        ]);
      }
    } finally {
      commit.resume();
      await Promise.allSettled([original]);
    }
  });

  it('B08 本文変更前に計算したメモリを編集中に確定しない', async () => {
    const { id } = (await (await save()).json()) as { id: string };
    const { version } = await content(id);
    await run('article');
    const revised = 'メモリの確定前に編集した本文';
    await run(
      'project_memory',
      'alice-project',
      mockStep(undefined, async (name) => {
        if (name === 'save-if-revision-current')
          expect((await edit(id, version, revised)).status).toBe(202);
      }),
    );
    expect(await app.env.DB.prepare('SELECT revision FROM memories').first()).toBeNull();
    expect(await app.env.DB.prepare('SELECT revision FROM memory_versions').first()).toBeNull();
    expect((await content(id)).content).toBe(revised);
  });

  it('問いの自動生成が無効な保存先では、本文を編集しても失敗済みの問いを待機に戻さない', async () => {
    const { id } = (await (await save()).json()) as { id: string };
    await app.env.DB.batch(legacyQuestionStatements(app.env, id));
    await app.env.DB.prepare("UPDATE questions SET status='failed' WHERE stock_id=?")
      .bind(id)
      .run();
    expect(
      (
        await app.request('/api/v1/projects/alice-project', {
          method: 'PATCH',
          body: { name: 'Alice project', description: '', auto_generate_questions: false },
        })
      ).status,
    ).toBe(200);
    expect((await edit(id, (await content(id)).version, '更新した本文')).status).toBe(202);
    const response = await app.request(`/api/v1/stocks/${id}/question`);
    expect(await response.json()).toMatchObject({ question: { status: 'failed' } });
  });

  it('B10 退会後に本文書き込みが完了しても非公開本文を削除する', async () => {
    await save();
    vi.mocked(app.env.ARTICLE_WORKFLOW.get).mockResolvedValue({
      status: async () => ({ status: 'complete' }),
    } as WorkflowInstance);
    const bucket = app.env.CONTENT;
    await bucket.put('bob/keep.txt', '別のユーザーの本文');
    app.env.CONTENT = new Proxy(bucket, {
      get(target, property) {
        if (property === 'put')
          return async (...args: Parameters<R2Bucket['put']>) => {
            expect((await app.request('/api/v1/me', { method: 'DELETE' })).status).toBe(200);
            return target.put(...args);
          };
        const original = Reflect.get(target, property, target);
        return typeof original === 'function' ? original.bind(target) : original;
      },
    });
    await run('article');
    expect((await bucket.list({ prefix: 'alice/' })).objects).toEqual([]);
    expect(await bucket.get('bob/keep.txt')).not.toBeNull();
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
    const { token } = (await (
      await app.request('/api/v1/tokens', { method: 'POST', body: { name: 'iPhone' } })
    ).json()) as { token: string };
    expect(
      (await edit(id, version, '委任トークン', { headers: { Authorization: `Bearer ${token}` } }))
        .status,
    ).toBe(403);
    const mcp = createApp({
      kind: 'mcp',
      tokenProjectId: null,
      user: {
        id: 'alice',
        name: 'Alice',
        onboarding_completed_at: '2026-10-30T00:00:00Z',
        bio: '',
        avatar_url: null,
      },
    });
    expect(
      (
        await mcp.request(
          `${app.env.APP_URL}/api/v1/stocks/${id}/content`,
          { method: 'PATCH', body: JSON.stringify({ version, text: '委任されたMCP' }) },
          app.env,
          app.ctx,
        )
      ).status,
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
    await app.env.DB.batch(legacyQuestionStatements(app.env, id));
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
