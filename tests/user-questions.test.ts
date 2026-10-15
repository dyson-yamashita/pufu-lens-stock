import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testApp, applyMigration, mockEvent, mockStep } from './helpers';
import { ArticleWorkflow } from '../server/workflows';
import { queueQuestionStatements } from '../server/db';
import type { Question } from '../shared/domain';
import type { Job } from '../server/env';

describe('ユーザーの問いの追加', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
    app.env.LOCAL_DEMO_ENABLED = 'true';
  });
  afterEach(async () => {
    await app.dispose();
  });
  const save = async (
    url = 'https://example.com/user-question',
    user = 'alice',
    project_id = 'alice-project',
  ) => {
    const response = await app.request('/api/v1/stocks', {
      method: 'POST',
      user,
      body: { project_id, url },
    });
    expect(response.status).toBe(202);
    return ((await response.json()) as { id: string }).id;
  };
  const add = (
    stock_id: string,
    text = '自分で考えた問い？',
    request_id = crypto.randomUUID(),
    options = {},
  ) =>
    app.request('/api/v1/questions', {
      method: 'POST',
      body: { stock_id, text, request_id },
      ...options,
    });
  const questions = async (stockId: string) =>
    (await (await app.request(`/api/v1/stocks/${stockId}/question`)).json()) as {
      question: Question;
      questions: Question[];
    };
  const userQuestions = async () =>
    (await (await app.request('/api/v1/questions?source=user')).json()) as {
      questions: Question[];
      total: number;
    };

  it('選んだストックに問いを追加し、ユーザーとしてすぐに一覧・詳細へ表示する', async () => {
    const id = await save();
    const jobs = await app.env.DB.prepare('SELECT COUNT(*) AS count FROM processing_jobs').first();
    const response = await add(id, '  記事の主張は、自分の状況でも成り立つだろうか？  ');
    expect(response.status).toBe(201);
    const { question } = (await response.json()) as { question: Question };
    expect(question).toMatchObject({
      stock_id: id,
      project_id: 'alice-project',
      source: 'user',
      status: 'ready',
      model: null,
      text: '記事の主張は、自分の状況でも成り立つだろうか？',
    });
    expect((await userQuestions()).questions).toEqual([question]);
    const detail = await questions(id);
    expect(detail.question.source).toBe('ai');
    expect(detail.questions).toHaveLength(2);
    expect(detail.questions.find((item) => item.id === question.id)).toEqual(question);
    expect(
      await app.env.DB.prepare('SELECT COUNT(*) AS count FROM processing_jobs').first(),
    ).toEqual(jobs);
  });
  it('同じストックに複数のユーザーの問いを追加でき、AIの生成で上書きされない', async () => {
    const id = await save();
    await add(id, '第一の問い？');
    await add(id, '第二の問い？');
    await app.env.DB.prepare("UPDATE articles SET status='ready', title='設計', summary_json=?")
      .bind(
        JSON.stringify({
          overview: '設計の概要',
          keyPoints: ['再試行に備えた設計が必要。'],
          topics: ['設計'],
        }),
      )
      .run();
    await app.env.DB.batch(queueQuestionStatements(app.env, id));
    const job = await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE kind='question'",
    ).first<Job>();
    await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(job!.id), mockStep());
    const detail = await questions(id);
    expect(detail.questions.filter((item) => item.source === 'ai')).toHaveLength(1);
    expect(
      detail.questions
        .filter((item) => item.source === 'user')
        .map((item) => item.text)
        .sort(),
    ).toEqual(['第一の問い？', '第二の問い？'].sort());
    expect(detail.questions.every((item) => item.status === 'ready')).toBe(true);
  });
  it('同じ追加の再送と同時送信では1件に保ち、内容の変更は拒否する', async () => {
    const id = await save();
    const requestId = crypto.randomUUID();
    const responses = await Promise.all([
      add(id, '同じ問い？', requestId),
      add(id, '同じ問い？', requestId),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    const first = (await responses[0].json()) as { question: Question };
    const replay = (await responses[1].json()) as { question: Question };
    expect(first.question.id).toBe(replay.question.id);
    expect((await userQuestions()).total).toBe(1);
    expect((await add(id, '異なる問い？', requestId)).status).toBe(409);
    const another = await save('https://example.com/other');
    expect((await add(another, '同じ問い？', requestId)).status).toBe(409);
  });
  it('500文字まで受け付け、空白・超過・属性の偽装を拒否する', async () => {
    const id = await save();
    expect((await add(id, '問'.repeat(500))).status).toBe(201);
    for (const text of ['', ' \n\t ', '問'.repeat(501)])
      expect((await add(id, text)).status).toBe(400);
    for (const extra of [
      { source: 'ai' },
      { status: 'generating' },
      { project_id: 'bob-project' },
      { request_id: 'invalid' },
    ])
      expect(
        (
          await app.request('/api/v1/questions', {
            method: 'POST',
            body: { stock_id: id, text: '問い？', ...extra },
          })
        ).status,
      ).toBe(400);
    expect((await userQuestions()).total).toBe(1);
  });
  it('未認証・他ユーザーのストック・別サイト・Bearerからの追加を拒否する', async () => {
    const id = await save();
    expect((await add(id, '問い？', undefined, { headers: { Cookie: '' } })).status).toBe(401);
    expect((await add(id, '問い？', undefined, { user: 'bob' })).status).toBe(404);
    expect((await add('missing-stock')).status).toBe(404);
    expect(
      (await add(id, '問い？', undefined, { headers: { Origin: 'https://evil.example.com' } }))
        .status,
    ).toBe(403);
    const created = await app.request('/api/v1/tokens', {
      method: 'POST',
      body: { name: 'iPhone' },
    });
    const { token } = (await created.json()) as { token: string };
    expect(
      (await add(id, '問い？', undefined, { headers: { Authorization: `Bearer ${token}` } }))
        .status,
    ).toBe(403);
    expect((await userQuestions()).total).toBe(0);
  });
  it('別ユーザーが同じリクエストIDを使っても互いの問いにアクセスしない', async () => {
    const alice = await save();
    const bob = await save('https://example.com/bob', 'bob', 'bob-project');
    const requestId = crypto.randomUUID();
    const first = (await (await add(alice, 'Aliceの問い？', requestId)).json()) as {
      question: Question;
    };
    const second = (await (await add(bob, 'Bobの問い？', requestId, { user: 'bob' })).json()) as {
      question: Question;
    };
    expect(first.question.id).not.toBe(second.question.id);
    expect((await userQuestions()).questions.map((item) => item.text)).toEqual(['Aliceの問い？']);
  });
  it('ストックの移動に追従し、削除でAIとユーザーの問いをまとめて削除する', async () => {
    const id = await save();
    await add(id);
    await app.request(`/api/v1/stocks/${id}`, {
      method: 'PATCH',
      body: { project_id: 'alice-second', note: '' },
    });
    expect(
      (await questions(id)).questions.every((item) => item.project_id === 'alice-second'),
    ).toBe(true);
    await app.request(`/api/v1/stocks/${id}`, { method: 'DELETE' });
    expect((await userQuestions()).total).toBe(0);
    expect(
      (await app.env.DB.prepare('SELECT COUNT(*) AS count FROM questions').first())!.count,
    ).toBe(0);
  });
  it('移行で既存の問いを保ち、AIは1件・ユーザーは複数件の制約にする', async () => {
    await app.dispose();
    app = await testApp({
      migrations: [
        '0001_initial.sql',
        '0002_unlimited_tokens.sql',
        '0003_user_profiles.sql',
        '0004_stock_questions.sql',
        '0005_question_sources.sql',
      ],
    });
    await applyMigration(app.env.DB, '0007_text_stocks.sql');
    await applyMigration(app.env.DB, '0011_question_deletion.sql');
    const id = await save();
    const before = await app.env.DB.prepare('SELECT * FROM questions').all();
    await applyMigration(app.env.DB, '0006_user_questions.sql');
    expect((await app.env.DB.prepare('SELECT * FROM questions').all()).results).toEqual(
      before.results,
    );
    await applyMigration(app.env.DB, '0008_question_favorites.sql');
    await applyMigration(app.env.DB, '0009_pufu_scores.sql');
    expect((await add(id, '追加1？')).status).toBe(201);
    expect((await add(id, '追加2？')).status).toBe(201);
    await expect(
      app.env.DB.prepare(
        "INSERT INTO questions (id,stock_id,source,status) VALUES ('duplicate-ai',?,'ai','queued')",
      )
        .bind(id)
        .run(),
    ).rejects.toThrow();
    expect((await questions(id)).questions).toHaveLength(3);
  });
});
