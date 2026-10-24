import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { applyMigration, mockEvent, mockStep, testApp } from './helpers';
import { queueQuestionStatements } from '../server/db';
import { ArticleWorkflow } from '../server/workflows';
import type { Job } from '../server/env';
import type { Question } from '../shared/domain';

describe('問いの削除', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
    app.env.LOCAL_DEMO_ENABLED = 'true';
    await app.env.DB.batch(fixture('first'));
  });
  afterEach(async () => {
    await app.dispose();
  });
  function fixture(id: string, user = 'alice') {
    return [
      app.env.DB.prepare(
        "INSERT INTO articles (id,user_id,canonical_url,source_url,title,domain,status,summary_json) VALUES (?,?,?,?,'再試行の設計','example.com','ready',?)",
      ).bind(
        `article-${id}`,
        user,
        `https://example.com/${id}`,
        `https://example.com/${id}`,
        JSON.stringify({ overview: '設計の概要', keyPoints: ['重複を防ぐ。'], topics: ['設計'] }),
      ),
      app.env.DB.prepare(
        'INSERT INTO stocks (id,user_id,project_id,article_id) VALUES (?,?,?,?)',
      ).bind(`stock-${id}`, user, `${user}-project`, `article-${id}`),
      app.env.DB.prepare(
        "INSERT INTO questions (id,stock_id,source,text,status) VALUES (?,?,'ai','AIの問い？','ready'), (?,?,'user','ユーザーの問い？','ready')",
      ).bind(`question-stock-${id}`, `stock-${id}`, `manual-${id}`, `stock-${id}`),
      app.env.DB.prepare(
        "INSERT INTO processing_jobs (id,user_id,kind,target_id,revision) VALUES (?,?,'question',?,1)",
      ).bind(`q-stock-${id}-1`, user, `stock-${id}`),
    ];
  }
  const remove = (id: string, options = {}) =>
    app.request(`/api/v1/questions/${id}`, { method: 'DELETE', ...options });
  const storedStock = () =>
    app.env.DB.prepare("SELECT * FROM stocks WHERE id='stock-first'").first();
  const questions = async () =>
    (await (await app.request('/api/v1/stocks/stock-first/question')).json()) as {
      question: Question | null;
      questions: Question[];
    };
  async function plan(questionId: string) {
    const response = await app.request(`/api/v1/questions/${questionId}/pufus`, {
      method: 'POST',
      body: { task: '失敗しても完了する状態をつくる。', request_id: crypto.randomUUID() },
    });
    expect(response.status).toBe(202);
    return ((await response.json()) as { id: string }).id;
  }

  it('ユーザーの問いだけを削除し、元の記事・ストック・AIの問いを保持する', async () => {
    const stock = await storedStock();
    expect((await remove('manual-first')).status).toBe(200);
    expect((await app.request('/api/v1/questions/manual-first')).status).toBe(404);
    expect(await storedStock()).toEqual(stock);
    expect((await questions()).questions.map((question) => question.id)).toEqual([
      'question-stock-first',
    ]);
    expect(
      (await app.env.DB.prepare(
        "SELECT status FROM processing_jobs WHERE kind='question'",
      ).first())!.status,
    ).not.toBe('done');
    expect((await app.env.DB.prepare('SELECT COUNT(*) AS n FROM articles').first())!.n).toBe(1);
    expect((await remove('manual-first')).status).toBe(404);
  });

  it('紐づく複数のプ譜と処理を削除・終了し、別の問いのプ譜は保持する', async () => {
    const first = await plan('question-stock-first');
    const second = await plan('question-stock-first');
    const manual = await plan('manual-first');
    const job = await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE kind='pufu' AND target_id=?",
    )
      .bind(first)
      .first<Job>();
    await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(job!.id), mockStep());
    expect((await remove('question-stock-first')).status).toBe(200);
    for (const id of [first, second]) {
      expect((await app.request(`/api/v1/pufus/${id}`)).status).toBe(404);
      expect(
        (await app.env.DB.prepare(
          "SELECT status FROM processing_jobs WHERE kind='pufu' AND target_id=?",
        )
          .bind(id)
          .first())!.status,
      ).toBe('done');
    }
    expect((await app.request(`/api/v1/pufus/${manual}`)).status).toBe(200);
    expect((await questions()).questions.map((q) => q.id)).toEqual(['manual-first']);
    await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(job!.id), mockStep());
    expect((await app.env.DB.prepare('SELECT COUNT(*) AS n FROM pufu_scores').first())!.n).toBe(1);
  });

  it('生成待ちのAIの問いを削除しても、記事処理の完了やジョブ再実行で復活しない', async () => {
    await app.env.DB.batch([
      app.env.DB.prepare("UPDATE articles SET status='queued'"),
      app.env.DB.prepare("UPDATE questions SET status='queued',text=NULL WHERE source='ai'"),
    ]);
    expect((await remove('question-stock-first')).status).toBe(200);
    expect((await storedStock())!.ai_question_dismissed).toBe(1);
    await app.env.DB.prepare("UPDATE articles SET status='ready'").run();
    await app.env.DB.batch(queueQuestionStatements(app.env));
    await new ArticleWorkflow(app.ctx, app.env).run(mockEvent('q-stock-first-1'), mockStep());
    expect((await questions()).questions.map((q) => q.id)).toEqual(['manual-first']);
    expect(
      (
        await app.request('/api/v1/stocks', {
          method: 'POST',
          body: { project_id: 'alice-project', url: 'https://example.com/first' },
        })
      ).status,
    ).toBe(200);
    expect((await questions()).questions).toHaveLength(1);
    expect(
      (
        await app.request('/api/v1/questions', {
          method: 'POST',
          body: { stock_id: 'stock-first', text: '追加の問い？' },
        })
      ).status,
    ).toBe(201);
    expect((await remove('manual-first')).status).toBe(200);
    const remaining = (await questions()).questions[0];
    expect((await remove(remaining.id)).status).toBe(200);
    expect(await questions()).toEqual({ question: null, questions: [] });
  });

  it('他ユーザー・未認証・別サイト・Bearerの削除と存在しないIDを拒否する', async () => {
    await app.env.DB.batch(fixture('bob', 'bob'));
    expect((await remove('manual-first', { user: 'bob' })).status).toBe(404);
    expect((await remove('manual-bob')).status).toBe(404);
    expect((await remove('missing')).status).toBe(404);
    expect((await remove('manual-first', { headers: { Cookie: '' } })).status).toBe(401);
    expect(
      (await remove('manual-first', { headers: { Origin: 'https://evil.example.com' } })).status,
    ).toBe(403);
    const tokenResponse = await app.request('/api/v1/tokens', {
      method: 'POST',
      body: { name: 'iPhone' },
    });
    const { token } = (await tokenResponse.json()) as { token: string };
    expect(
      (await remove('manual-first', { headers: { Authorization: `Bearer ${token}` } })).status,
    ).toBe(403);
    expect((await questions()).questions).toHaveLength(2);
    expect((await storedStock())!.ai_question_dismissed).toBe(0);
  });

  it('同じ記事を別プロジェクトに保存した問いには影響しない', async () => {
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO stocks (id,user_id,project_id,article_id) VALUES ('second','alice','alice-second','article-first')",
      ),
      ...queueQuestionStatements(app.env, 'second'),
    ]);
    await remove('question-stock-first');
    await app.env.DB.batch(queueQuestionStatements(app.env));
    const list = (await (await app.request('/api/v1/questions?source=ai')).json()) as {
      questions: Question[];
      total: number;
    };
    expect(list.total).toBe(1);
    expect(list.questions[0].stock_id).toBe('second');
  });

  it('移行で既存ストックの情報と問いを保持する', async () => {
    await app.dispose();
    const migrations = (await readdir(new URL('../migrations/', import.meta.url)))
      .filter((name) => name.endsWith('.sql') && name < '0011_question_deletion.sql')
      .sort();
    app = await testApp({ migrations });
    await app.env.DB.batch(fixture('first'));
    const before = await storedStock();
    const beforeQuestions = (await app.env.DB.prepare('SELECT * FROM questions ORDER BY id').all())
      .results;
    await applyMigration(app.env.DB, '0011_question_deletion.sql');
    expect(await storedStock()).toEqual({ ...before, ai_question_dismissed: 0 });
    expect((await app.env.DB.prepare('SELECT * FROM questions ORDER BY id').all()).results).toEqual(
      beforeQuestions,
    );
    await applyMigration(app.env.DB, '0012_pufu_phases.sql');
    await applyMigration(app.env.DB, '0016_independent_questions.sql');
    await applyMigration(app.env.DB, '0028_question_notes.sql');
    expect((await remove('manual-first')).status).toBe(200);
  });
});
