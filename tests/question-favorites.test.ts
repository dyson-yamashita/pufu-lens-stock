import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Question } from '../shared/domain';
import { ArticleWorkflow } from '../server/workflows';
import type { Job } from '../server/env';
import { applyMigration, mockEvent, mockStep, testApp, upgradeRelationsSchema } from './helpers';

describe('問いのお気に入り', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
    app.env.LOCAL_DEMO_ENABLED = 'true';
  });
  afterEach(async () => {
    await app.dispose();
  });
  function fixture(
    id: string,
    source: 'ai' | 'user' = 'ai',
    options: { user?: string; project?: string; favorite?: boolean; text?: string } = {},
  ) {
    const user = options.user ?? 'alice';
    const statements = [
      app.env.DB.prepare(
        "INSERT INTO articles (id,user_id,canonical_url,source_url,title,domain,status,summary_json) VALUES (?,?,?,?,?,'example.com','ready',?)",
      ).bind(
        `article-${id}`,
        user,
        `https://example.com/${id}`,
        `https://example.com/${id}`,
        `記事${id}`,
        JSON.stringify({
          overview: '設計の概要',
          keyPoints: ['再試行に備える。'],
          topics: ['設計'],
        }),
      ),
      app.env.DB.prepare(
        'INSERT INTO stocks (id,user_id,project_id,article_id) VALUES (?,?,?,?)',
      ).bind(`stock-${id}`, user, options.project ?? `${user}-project`, `article-${id}`),
      app.env.DB.prepare(
        "INSERT INTO questions (id,stock_id,source,text,status,created_at) VALUES (?,?,?,?,'ready','2026-10-15T00:00:00.000Z')",
      ).bind(id, `stock-${id}`, source, options.text ?? `${id}の問い？`),
    ];
    if (options.favorite)
      statements.push(
        app.env.DB.prepare('UPDATE questions SET is_favorite = 1 WHERE id = ?').bind(id),
      );
    return statements;
  }
  const favorite = (id: string, value: boolean, options = {}) =>
    app.request(`/api/v1/questions/${id}/favorite`, {
      method: 'PATCH',
      body: { is_favorite: value },
      ...options,
    });
  async function list(params = '', user = 'alice') {
    const response = await app.request(`/api/v1/questions${params}`, { user });
    expect(response.status).toBe(200);
    return (await response.json()) as { questions: Question[]; total: number };
  }

  it('AI・ユーザーの問いを個別に登録・解除し、再取得と詳細でも保持する', async () => {
    await app.env.DB.batch([...fixture('ai'), ...fixture('user', 'user')]);
    expect((await list()).questions.every((q) => q.is_favorite === 0)).toBe(true);
    for (const id of ['ai', 'user']) {
      const before = (await list()).questions.find((q) => q.id === id)!;
      expect(await (await favorite(id, true)).json()).toEqual({ id, is_favorite: 1 });
      expect((await favorite(id, true)).status).toBe(200);
      expect((await list()).questions.find((q) => q.id === id)).toMatchObject({
        is_favorite: 1,
        text: before.text,
        source: before.source,
        status: before.status,
        created_at: before.created_at,
      });
      const detail = (await (await app.request(`/api/v1/stocks/stock-${id}/question`)).json()) as {
        questions: Question[];
      };
      expect(detail.questions[0].is_favorite).toBe(1);
    }
    expect((await list('?favorite=true')).total).toBe(2);
    expect(await (await favorite('ai', false)).json()).toEqual({ id: 'ai', is_favorite: 0 });
    expect((await list('?favorite=true')).questions.map((q) => q.id)).toEqual(['user']);
    expect((await list('?favorite=false')).total).toBe(2);
  });

  it('作成元・プロジェクト・検索と組み合わせ、本人のお気に入りだけを絞り込む', async () => {
    await app.env.DB.batch([
      ...fixture('first-ai', 'ai', { favorite: true, text: '100%の問い？' }),
      ...fixture('first-user', 'user', { favorite: true }),
      ...fixture('second', 'ai', { favorite: true, project: 'alice-second' }),
      ...fixture('normal'),
      ...fixture('bob', 'ai', { favorite: true, user: 'bob' }),
    ]);
    expect((await list('?favorite=true')).total).toBe(3);
    expect((await list('?favorite=true&source=ai')).total).toBe(2);
    expect((await list('?favorite=true&source=user')).questions[0].id).toBe('first-user');
    expect((await list('?favorite=true&project_id=alice-project&q=100%25')).questions[0].id).toBe(
      'first-ai',
    );
    expect((await list('?favorite=true&project_id=alice-second')).total).toBe(1);
    expect((await list('?favorite=true&status=failed')).total).toBe(0);
    expect((await list('?favorite=true', 'bob')).questions.map((q) => q.id)).toEqual(['bob']);
    expect(
      (await app.request('/api/v1/questions?favorite=true&project_id=bob-project')).status,
    ).toBe(404);
  });

  it('お気に入りの件数とページ分割を一致させ、通常の問いを混ぜない', async () => {
    await app.env.DB.batch([
      ...Array.from({ length: 26 }, (_, index) =>
        fixture(`fav-${String(index).padStart(2, '0')}`, index % 2 ? 'user' : 'ai', {
          favorite: true,
        }),
      ).flat(),
      ...fixture('normal'),
    ]);
    const first = await list('?favorite=true&page=1');
    const second = await list('?favorite=true&page=2');
    expect(first.total).toBe(26);
    expect(second.total).toBe(26);
    expect(first.questions).toHaveLength(24);
    expect(second.questions).toHaveLength(2);
    const questions = [...first.questions, ...second.questions];
    expect(new Set(questions.map((q) => q.id)).size).toBe(26);
    expect(questions.every((q) => q.is_favorite === 1)).toBe(true);
  });

  it('他ユーザー・未認証・別サイト・Bearerからの変更と不正入力を拒否する', async () => {
    await app.env.DB.batch(fixture('owned'));
    expect((await favorite('owned', true, { user: 'bob' })).status).toBe(404);
    expect((await favorite('missing', true)).status).toBe(404);
    expect((await favorite('owned', true, { headers: { Cookie: '' } })).status).toBe(401);
    expect(
      (await favorite('owned', true, { headers: { Origin: 'https://evil.example.com' } })).status,
    ).toBe(403);
    const tokenResponse = await app.request('/api/v1/tokens', {
      method: 'POST',
      body: { name: 'iPhone' },
    });
    const { token } = (await tokenResponse.json()) as { token: string };
    expect(
      (await favorite('owned', true, { headers: { Authorization: `Bearer ${token}` } })).status,
    ).toBe(403);
    for (const body of [
      {},
      { is_favorite: 'true' },
      { is_favorite: 1 },
      { is_favorite: true, source: 'user' },
    ])
      expect(
        (await app.request('/api/v1/questions/owned/favorite', { method: 'PATCH', body })).status,
      ).toBe(400);
    expect((await app.request('/api/v1/questions?favorite=invalid')).status).toBe(400);
    expect((await list()).questions[0].is_favorite).toBe(0);
  });

  it('生成の再試行・ストックの移動と削除でもお気に入りを保ち、問いの削除で消える', async () => {
    await app.env.DB.batch(fixture('retry'));
    await app.env.DB.prepare("UPDATE questions SET status = 'failed' WHERE id = 'retry'").run();
    await favorite('retry', true);
    expect(
      (await app.request('/api/v1/stocks/stock-retry/question/retry', { method: 'POST' })).status,
    ).toBe(202);
    const job = await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE kind = 'question'",
    ).first<Job>();
    await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(job!.id), mockStep());
    expect((await list('?favorite=true')).questions[0]).toMatchObject({
      status: 'ready',
      is_favorite: 1,
    });
    await app.request('/api/v1/stocks/stock-retry', {
      method: 'PATCH',
      body: { project_id: 'alice-second', note: '' },
    });
    expect((await list('?favorite=true&project_id=alice-second')).total).toBe(1);
    expect((await app.request('/api/v1/stocks/stock-retry', { method: 'DELETE' })).status).toBe(
      200,
    );
    expect((await list('?favorite=true')).questions).toMatchObject([
      { id: 'retry', stock_id: null, project_id: 'alice-second', is_favorite: 1, stock_ids: [] },
    ]);
    expect((await favorite('retry', false)).status).toBe(200);
    expect((await list('?favorite=true')).total).toBe(0);
    expect((await app.request('/api/v1/questions/retry', { method: 'DELETE' })).status).toBe(200);
    expect((await favorite('retry', true)).status).toBe(404);
  });

  it('移行で既存の問いを変更せず、お気に入りを初期値の未選択にする', async () => {
    await app.dispose();
    app = await testApp({
      migrations: [
        '0001_initial.sql',
        '0002_unlimited_tokens.sql',
        '0003_user_profiles.sql',
        '0004_stock_questions.sql',
        '0005_question_sources.sql',
        '0006_user_questions.sql',
        '0007_text_stocks.sql',
      ],
    });
    await app.env.DB.batch([...fixture('old-ai'), ...fixture('old-user', 'user')]);
    const before = await app.env.DB.prepare('SELECT * FROM questions ORDER BY id').all();
    await applyMigration(app.env.DB, '0008_question_favorites.sql');
    const after = await app.env.DB.prepare('SELECT * FROM questions ORDER BY id').all();
    expect(after.results).toEqual(before.results.map((q) => ({ ...q, is_favorite: 0 })));
    await applyMigration(app.env.DB, '0009_pufu_scores.sql');
    await applyMigration(app.env.DB, '0012_pufu_phases.sql');
    await applyMigration(app.env.DB, '0016_independent_questions.sql');
    await upgradeRelationsSchema(app.env.DB);
    expect((await list()).total).toBe(2);
    expect((await favorite('old-ai', true)).status).toBe(200);
  });
});
