import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testApp, applyMigration, mockEvent, mockStep } from './helpers';
import { queueQuestionStatements, jobFailureStatements } from '../server/db';
import { ArticleWorkflow } from '../server/workflows';
import { scheduledMaintenance } from '../server/jobs';
import type { Env, Job } from '../server/env';
import type { Question } from '../shared/domain';

const summary = {
  overview: '再試行できる非同期処理の設計。',
  keyPoints: ['重複実行に備えた設計が必要。'],
  topics: ['非同期処理'],
};
describe('問い・ストック・プロジェクトの関連', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
    app.env.LOCAL_DEMO_ENABLED = 'true';
  });
  afterEach(async () => {
    await app.dispose();
  });
  const save = async (
    project_id = 'alice-project',
    url = 'https://example.com/question',
    headers = {},
  ) => {
    const response = await app.request('/api/v1/stocks', {
      method: 'POST',
      body: { project_id, url, note: '再試行の設計を考えたい。' },
      headers,
    });
    expect([200, 202]).toContain(response.status);
    return ((await response.json()) as { id: string }).id;
  };
  const question = async (stockId: string) =>
    (
      (await (await app.request(`/api/v1/stocks/${stockId}/question`)).json()) as {
        question: Question;
      }
    ).question;
  const list = async (query = '', user = 'alice') =>
    (await (await app.request(`/api/v1/questions${query}`, { user })).json()) as {
      questions: Question[];
      total: number;
    };
  async function ready(stockId: string) {
    await app.env.DB.prepare(
      "UPDATE articles SET status = 'ready', title = '非同期処理の設計', summary_json = ? WHERE id = (SELECT article_id FROM stocks WHERE id = ?)",
    )
      .bind(JSON.stringify(summary), stockId)
      .run();
    await app.env.DB.batch(queueQuestionStatements(app.env, stockId));
  }
  async function run(stockId: string) {
    const job = await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE kind = 'question' AND target_id = ? ORDER BY revision DESC LIMIT 1",
    )
      .bind(stockId)
      .first<Job>();
    expect(job).not.toBeNull();
    await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(job!.id), mockStep());
    return job!;
  }
  it('保存時に1つの問いを登録し、記事の要約ができるまで生成を待つ', async () => {
    const id = await save();
    expect(await question(id)).toMatchObject({
      stock_id: id,
      status: 'queued',
      text: null,
      project_id: 'alice-project',
      article_status: 'queued',
    });
    expect(
      await app.env.DB.prepare("SELECT id FROM processing_jobs WHERE kind = 'question'").first(),
    ).toBeNull();
    await ready(id);
    const job = await run(id);
    const generated = await question(id);
    expect(generated.status).toBe('ready');
    expect(generated.text).toContain('重複実行');
    expect(generated.model).toBe('local-question-template');
    await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(job.id), mockStep());
    expect((await list()).questions).toHaveLength(1);
    expect((await question(id)).text).toBe(generated.text);
  });
  it('重複とIdempotency-Keyの再送で問いを増やさず、別プロジェクトでは別の問いを持つ', async () => {
    const headers = { 'Idempotency-Key': 'question-save' };
    const first = await save('alice-project', undefined, headers);
    expect(await save('alice-project', undefined, headers)).toBe(first);
    expect(await save()).toBe(first);
    const second = await save('alice-second');
    expect(second).not.toBe(first);
    await ready(first);
    await app.env.DB.batch(queueQuestionStatements(app.env, second));
    await run(first);
    await run(second);
    const questions = (await list()).questions;
    expect(questions).toHaveLength(2);
    expect(new Set(questions.map((q) => q.stock_id)).size).toBe(2);
    expect((await question(first)).text).toContain('Alice project');
    expect((await question(second)).text).toContain('Second project');
  });
  it('同じURLを同時保存しても1ストック・1問いになる', async () => {
    const ids = await Promise.all([save(), save()]);
    expect(ids[0]).toBe(ids[1]);
    expect((await list()).total).toBe(1);
  });
  it('作成元をAIとユーザーに分類し、一覧・詳細・検索で同じ作成元を返す', async () => {
    const aiId = await save();
    expect(await question(aiId)).toMatchObject({ source: 'ai', status: 'queued' });
    const userId = await save('alice-second', 'https://example.com/user-question');
    await app.env.DB.prepare(
      "UPDATE questions SET source = 'user', text = '自分で考えた問い？', status = 'ready' WHERE stock_id = ?",
    )
      .bind(userId)
      .run();
    expect(await question(userId)).toMatchObject({ source: 'user', text: '自分で考えた問い？' });
    const ai = await list('?source=ai');
    const user = await list('?source=user');
    expect(ai.total).toBe(1);
    expect(ai.questions[0]).toMatchObject({ stock_id: aiId, source: 'ai' });
    expect(user.total).toBe(1);
    expect(user.questions[0]).toMatchObject({ stock_id: userId, source: 'user' });
    expect((await list('?source=user&project_id=alice-project')).total).toBe(0);
    expect((await list('?source=user&q=' + encodeURIComponent('自分で考えた'))).total).toBe(1);
    expect((await list('?source=user', 'bob')).total).toBe(0);
    expect((await app.request('/api/v1/questions?source=unknown')).status).toBe(400);
  });
  it('ユーザーの問いを自動生成処理で上書きしない', async () => {
    const id = await save();
    await ready(id);
    await app.env.DB.prepare(
      "UPDATE questions SET source = 'user', text = 'ユーザーの問い？' WHERE stock_id = ?",
    )
      .bind(id)
      .run();
    await run(id);
    expect(await question(id)).toMatchObject({ source: 'user', text: 'ユーザーの問い？' });
    expect(
      (await app.env.DB.prepare('SELECT model FROM questions WHERE stock_id = ?')
        .bind(id)
        .first())!,
    ).toMatchObject({ model: null });
  });
  it('要約済みの記事を別プロジェクトへ追加すると、直ちにその問いの生成を登録する', async () => {
    const first = await save();
    await ready(first);
    await run(first);
    const second = await save('alice-second');
    await run(second);
    expect((await question(second)).status).toBe('ready');
  });
  it('AIには記事の要約・保存先・メモを渡し、1つの問いとして保存する', async () => {
    const id = await save();
    await ready(id);
    await app.env.DB.prepare(
      "UPDATE projects SET description = '堅牢なアプリを設計する。' WHERE id = 'alice-project'",
    ).run();
    const ai = vi.fn<NonNullable<Env['AI']>['run']>(async () => ({
      response: JSON.stringify({
        text: '再試行で二重保存が起きないことを、どう検証できるだろう？',
      }),
    }));
    app.env.AI = { run: ai };
    await run(id);
    expect(ai).toHaveBeenCalledOnce();
    const input = JSON.parse(ai.mock.calls[0][1].messages[1].content);
    expect(input).toMatchObject({
      summary,
      note: '再試行の設計を考えたい。',
      project: { name: 'Alice project', description: '堅牢なアプリを設計する。' },
    });
    expect(await question(id)).toMatchObject({
      status: 'ready',
      text: '再試行で二重保存が起きないことを、どう検証できるだろう？',
      model: app.env.AI_MODEL,
    });
  });
  it('問いの失敗で記事の要約を失わず、再試行でも問いは1つのまま', async () => {
    const id = await save();
    await ready(id);
    app.env.AI = { run: vi.fn(async () => ({ response: '{"text":""}' })) };
    await expect(run(id)).rejects.toThrow();
    expect((await question(id)).status).toBe('failed');
    expect(
      (await app.env.DB.prepare('SELECT status, summary_json FROM articles').first())!,
    ).toMatchObject({ status: 'ready', summary_json: JSON.stringify(summary) });
    const originalId = (await question(id)).id;
    expect(
      (await app.request(`/api/v1/stocks/${id}/question/retry`, { method: 'POST' })).status,
    ).toBe(202);
    app.env.AI = undefined;
    const job = await run(id);
    expect(job.revision).toBe(2);
    expect(await question(id)).toMatchObject({ id: originalId, status: 'ready' });
    expect((await list()).total).toBe(1);
    expect(
      (await app.request(`/api/v1/stocks/${id}/question/retry`, { method: 'POST' })).status,
    ).toBe(409);
  });
  it('記事取得の失敗は問いにも伝わり、記事の再取得で生成待ちに戻る', async () => {
    const id = await save();
    const job = await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE kind = 'article'",
    ).first<Job>();
    await app.env.DB.batch(jobFailureStatements(app.env, job!, '記事を取得できませんでした。'));
    expect((await question(id)).status).toBe('failed');
    expect(
      (await app.request(`/api/v1/stocks/${id}/question/retry`, { method: 'POST' })).status,
    ).toBe(409);
    expect((await app.request(`/api/v1/stocks/${id}/retry`, { method: 'POST' })).status).toBe(202);
    expect((await question(id)).status).toBe('queued');
    await ready(id);
    await run(id);
    expect((await question(id)).status).toBe('ready');
  });
  it('本人だけが問いを取得でき、検索とプロジェクト・状態による絞り込みができる', async () => {
    const id = await save();
    await ready(id);
    await run(id);
    await save('alice-second', 'https://example.com/pending');
    expect((await list('?project_id=alice-project')).total).toBe(1);
    expect((await list('?status=processing')).total).toBe(1);
    expect((await list('?status=ready&q=' + encodeURIComponent('重複実行'))).total).toBe(1);
    expect((await list('?q=' + encodeURIComponent('%'))).total).toBe(0);
    expect((await list('', 'bob')).total).toBe(0);
    expect(
      (await app.request('/api/v1/questions?project_id=alice-project', { user: 'bob' })).status,
    ).toBe(404);
    for (const [path, method] of [
      [`/api/v1/stocks/${id}/question`, 'GET'],
      [`/api/v1/stocks/${id}`, 'GET'],
      [`/api/v1/stocks/${id}/question/retry`, 'POST'],
    ])
      expect((await app.request(path, { method, user: 'bob' })).status).toBe(404);
    expect((await app.request('/api/v1/questions?status=wrong')).status).toBe(400);
  });
  it('ストック移動に追従し、ストック・プロジェクトの削除で問いも消える', async () => {
    const id = await save();
    await ready(id);
    await run(id);
    const before = await question(id);
    expect(
      (
        await app.request(`/api/v1/stocks/${id}`, {
          method: 'PATCH',
          body: { project_id: 'alice-second', note: '' },
        })
      ).status,
    ).toBe(200);
    expect(await question(id)).toMatchObject({
      id: before.id,
      text: before.text,
      project_id: 'alice-second',
    });
    expect((await list('?project_id=alice-project')).total).toBe(0);
    await app.request(`/api/v1/stocks/${id}`, { method: 'DELETE' });
    expect((await list()).total).toBe(0);
    await save();
    await app.request('/api/v1/projects/alice-project', { method: 'DELETE' });
    expect((await list()).total).toBe(0);
  });
  it('生成中にストックを削除しても問いを復活させない', async () => {
    const id = await save();
    await ready(id);
    app.env.AI = {
      run: vi.fn(async () => {
        await app.request(`/api/v1/stocks/${id}`, { method: 'DELETE' });
        return { response: JSON.stringify({ text: '削除済みの問い？' }) };
      }),
    };
    await run(id);
    expect((await list()).total).toBe(0);
  });
  it('中断後の古い生成結果で再試行した問いを上書きしない', async () => {
    const id = await save();
    await ready(id);
    app.env.AI = {
      run: vi.fn(async () => {
        const job = await app.env.DB.prepare(
          "SELECT * FROM processing_jobs WHERE kind = 'question' AND target_id = ? AND revision = 1",
        )
          .bind(id)
          .first<Job>();
        await app.env.DB.batch(jobFailureStatements(app.env, job!, '処理が中断されました。'));
        expect(
          (await app.request(`/api/v1/stocks/${id}/question/retry`, { method: 'POST' })).status,
        ).toBe(202);
        return { response: JSON.stringify({ text: '古い世代の問い？' }) };
      }),
    };
    await run(id);
    expect(await question(id)).toMatchObject({ status: 'queued', text: null });
    app.env.AI = undefined;
    expect((await run(id)).revision).toBe(2);
    expect((await question(id)).text).not.toBe('古い世代の問い？');
  });
  it('未認証とショートカット用トークンでは問いを取得・再試行できない', async () => {
    const id = await save();
    expect((await app.request('/api/v1/questions', { headers: { Cookie: '' } })).status).toBe(401);
    const created = await app.request('/api/v1/tokens', {
      method: 'POST',
      body: { name: 'iPhone', expires_days: null },
    });
    const { token } = (await created.json()) as { token: string };
    const headers = { Authorization: `Bearer ${token}`, Cookie: '', Origin: '' };
    for (const [path, method] of [
      ['/api/v1/questions', 'GET'],
      [`/api/v1/stocks/${id}/question`, 'GET'],
      [`/api/v1/stocks/${id}/question/retry`, 'POST'],
    ])
      expect((await app.request(path, { method, headers })).status).toBe(403);
  });
  it('25件の問いを24件ずつ重複なく取得できる', async () => {
    await app.env.DB.batch(
      Array.from({ length: 25 }, (_, index) => [
        app.env.DB.prepare(
          "INSERT INTO articles (id,user_id,canonical_url,source_url,title,domain) VALUES (?,'alice',?,?,?,'example.com')",
        ).bind(
          `page-article-${index}`,
          `https://example.com/page-${index}`,
          `https://example.com/page-${index}`,
          `記事${index}`,
        ),
        app.env.DB.prepare(
          "INSERT INTO stocks (id,user_id,project_id,article_id) VALUES (?,'alice','alice-project',?)",
        ).bind(`page-stock-${index}`, `page-article-${index}`),
      ]).flat(),
    );
    await app.env.DB.batch(queueQuestionStatements(app.env));
    const first = await list('?page=1');
    const second = await list('?page=2');
    expect(first.total).toBe(25);
    expect(first.questions).toHaveLength(24);
    expect(second.questions).toHaveLength(1);
    expect(new Set([...first.questions, ...second.questions].map((q) => q.id)).size).toBe(25);
  });
  it('Cronが中断された問いを失敗として記録し、画面から再試行できる', async () => {
    const id = await save();
    await ready(id);
    await app.request('/api/v1/questions');
    await app.env.DB.prepare(
      "UPDATE processing_jobs SET updated_at = '2020-01-01T00:00:00.000Z' WHERE kind = 'question'",
    ).run();
    app.env.ARTICLE_WORKFLOW = {
      get: vi.fn(async () => ({ status: async () => ({ status: 'errored' }) })),
      create: vi.fn(async () => ({ id: 'instance' })),
    } as unknown as typeof app.env.ARTICLE_WORKFLOW;
    await scheduledMaintenance(app.env);
    expect((await question(id)).status).toBe('failed');
    expect(
      (await app.request(`/api/v1/stocks/${id}/question/retry`, { method: 'POST' })).status,
    ).toBe(202);
  });
  it('作成元の移行で既存の問いの内容・状態・関連を保持し、AIに分類する', async () => {
    await app.dispose();
    app = await testApp({
      migrations: [
        '0001_initial.sql',
        '0002_unlimited_tokens.sql',
        '0003_user_profiles.sql',
        '0004_stock_questions.sql',
      ],
    });
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO articles (id,user_id,canonical_url,source_url,title,domain,status,summary_json) VALUES ('old-article','alice','https://example.com/old-source','https://example.com/old-source','既存記事','example.com','ready',?)",
      ).bind(JSON.stringify(summary)),
      app.env.DB.prepare(
        "INSERT INTO stocks (id,user_id,project_id,article_id) VALUES ('old-stock','alice','alice-project','old-article')",
      ),
      app.env.DB.prepare(
        "INSERT INTO questions (id,stock_id,text,status,model) VALUES ('old-question','old-stock','既存の問い？','ready','local-question-template')",
      ),
    ]);
    const before = await app.env.DB.prepare('SELECT * FROM questions').all();
    await applyMigration(app.env.DB, '0005_question_sources.sql');
    const after = await app.env.DB.prepare('SELECT * FROM questions').all();
    await applyMigration(app.env.DB, '0007_text_stocks.sql');
    await applyMigration(app.env.DB, '0008_question_favorites.sql');
    await applyMigration(app.env.DB, '0009_pufu_scores.sql');
    expect(after.results).toEqual(before.results.map((row) => ({ ...row, source: 'ai' })));
    expect((await list('?source=ai')).questions[0]).toMatchObject({
      stock_id: 'old-stock',
      text: '既存の問い？',
      source: 'ai',
    });
  });
  it('移行で既存ストックと処理要求を保持し、要約済みのストックの問いを登録する', async () => {
    await app.dispose();
    app = await testApp({
      migrations: ['0001_initial.sql', '0002_unlimited_tokens.sql', '0003_user_profiles.sql'],
    });
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO articles (id,user_id,canonical_url,source_url,title,domain,status,summary_json) VALUES ('existing-article','alice','https://example.com/old','https://example.com/old','既存記事','example.com','ready',?)",
      ).bind(JSON.stringify(summary)),
      app.env.DB.prepare(
        "INSERT INTO stocks (id,user_id,project_id,article_id) VALUES ('existing-stock','alice','alice-project','existing-article')",
      ),
      app.env.DB.prepare(
        "INSERT INTO processing_jobs (id,user_id,kind,target_id,revision) VALUES ('old-job','alice','user_memory','alice',1)",
      ),
    ]);
    const previous = await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE id = 'old-job'",
    ).first();
    await applyMigration(app.env.DB, '0004_stock_questions.sql');
    await applyMigration(app.env.DB, '0005_question_sources.sql');
    await applyMigration(app.env.DB, '0007_text_stocks.sql');
    expect(
      await app.env.DB.prepare("SELECT * FROM processing_jobs WHERE id = 'old-job'").first(),
    ).toEqual(previous);
    await applyMigration(app.env.DB, '0008_question_favorites.sql');
    await applyMigration(app.env.DB, '0009_pufu_scores.sql');
    expect((await list()).total).toBe(1);
    app.env.LOCAL_DEMO_ENABLED = 'true';
    await run('existing-stock');
    expect((await question('existing-stock')).status).toBe('ready');
  });
});
