import { readdir } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigration, mockEvent, mockStep, testApp } from './helpers';
import { ArticleWorkflow } from '../server/workflows';
import type { Question } from '../shared/domain';
import type { Pufu } from '../shared/pufu';
import type { Job } from '../server/env';

describe('プロジェクトに所属する独立した問い', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
    app.env.LOCAL_DEMO_ENABLED = 'true';
  });
  afterEach(async () => {
    await app.dispose();
  });
  const add = (extra = {}, user = 'alice') =>
    app.request('/api/v1/questions', {
      method: 'POST',
      user,
      body: { project_id: 'alice-project', text: '独立した問い？', ...extra },
    });
  const save = async () => {
    const response = await add();
    expect(response.status).toBe(201);
    return ((await response.json()) as { question: Question }).question;
  };
  it('ストックなしで即時保存し、一覧・検索・お気に入り・詳細・削除を扱う', async () => {
    const question = await save();
    expect(question).toMatchObject({
      project_id: 'alice-project',
      stock_id: null,
      article_title: null,
      article_status: null,
      domain: null,
      status: 'ready',
      source: 'user',
    });
    for (const query of ['', '?q=独立', '?project_id=alice-project']) {
      const result = (await (await app.request(`/api/v1/questions${query}`)).json()) as {
        questions: Question[];
        total: number;
      };
      expect(result.total).toBe(1);
      expect(result.questions[0].id).toBe(question.id);
    }
    expect(
      (
        await app.request(`/api/v1/questions/${question.id}/favorite`, {
          method: 'PATCH',
          body: { is_favorite: true },
        })
      ).status,
    ).toBe(200);
    expect(
      (await (await app.request('/api/v1/questions?favorite=true')).json()) as unknown,
    ).toMatchObject({ total: 1 });
    expect((await app.request(`/api/v1/questions/${question.id}`)).status).toBe(200);
    expect(
      (await app.request(`/api/v1/questions/${question.id}`, { method: 'DELETE' })).status,
    ).toBe(200);
    expect((await app.request(`/api/v1/questions/${question.id}`)).status).toBe(404);
  });
  it('所属必須と所有権を検証し、他ユーザーによる閲覧・お気に入り・削除を拒否する', async () => {
    expect(
      (await app.request('/api/v1/questions', { method: 'POST', body: { text: '所属なし' } }))
        .status,
    ).toBe(400);
    expect((await add({ project_id: 'bob-project' })).status).toBe(404);
    const question = await save();
    for (const [suffix, method, body] of [
      ['', 'GET', undefined],
      ['', 'DELETE', undefined],
      ['/favorite', 'PATCH', { is_favorite: true }],
    ] as const)
      expect(
        (
          await app.request(`/api/v1/questions/${question.id}${suffix}`, {
            method,
            body,
            user: 'bob',
          })
        ).status,
      ).toBe(404);
    expect(await (await app.request('/api/v1/questions', { user: 'bob' })).json()).toMatchObject({
      total: 0,
    });
  });
  it('再送は一件に保ち、同じIDで所属または関連ストックを変えると拒否する', async () => {
    const request_id = crypto.randomUUID();
    const responses = await Promise.all([add({ request_id }), add({ request_id })]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    expect((await add({ request_id, project_id: 'alice-second' })).status).toBe(409);
    expect((await add({ request_id, text: '別の問い' })).status).toBe(409);
  });
  it('独立した問いからストックなしのプ譜を生成し、プロジェクト削除で一緒に消す', async () => {
    for (const project of [null, 'alice-project']) {
      await app.env.DB.prepare(
        'INSERT INTO memories (id,user_id,project_id,revision,text,data_json,article_count,model) VALUES (?, ?, ?, 3, ?, ?, 0, ?)',
      )
        .bind(
          project ? 'project-memory' : 'user-memory',
          'alice',
          project,
          project ? 'プロジェクトの知識' : 'ユーザーの知識',
          JSON.stringify({ interests: [], knowledge: [], questions: [] }),
          'test',
        )
        .run();
    }
    const question = await save();
    const response = await app.request(`/api/v1/questions/${question.id}/pufus`, {
      method: 'POST',
      body: { task: '問いを検証する', request_id: crypto.randomUUID() },
    });
    expect(response.status).toBe(202);
    const { id } = (await response.json()) as { id: string };
    const job = await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE kind='pufu' AND target_id=?",
    )
      .bind(id)
      .first<Job>();
    await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(job!.id), mockStep());
    const { pufu } = (await (await app.request(`/api/v1/pufus/${id}`)).json()) as { pufu: Pufu };
    expect(pufu.status).toBe('ready');
    expect(pufu.context.stock).toBeNull();
    expect(pufu.context.userMemory).toMatchObject({ revision: 3, text: 'ユーザーの知識' });
    expect(pufu.context.projectMemory).toMatchObject({ revision: 3, text: 'プロジェクトの知識' });
    expect(pufu.score?.gainingGoal.text).toBe('問いを検証する');
    expect((await app.request('/api/v1/projects/alice-project', { method: 'DELETE' })).status).toBe(
      200,
    );
    expect((await app.request(`/api/v1/questions/${question.id}`)).status).toBe(404);
    expect((await app.request(`/api/v1/pufus/${id}`)).status).toBe(404);
  });
  it('移行で既存の問い・お気に入り・プ譜・局面を保ち、旧INSERTと移動・削除も維持する', async () => {
    await app.dispose();
    const migrations = (await readdir(new URL('../migrations/', import.meta.url)))
      .filter((f) => f.endsWith('.sql') && f < '0014')
      .sort();
    app = await testApp({ migrations });
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO articles(id,user_id,canonical_url,source_url,title,domain,status) VALUES ('a','alice','https://example.com/a','https://example.com/a','記事','example.com','ready')",
      ),
      app.env.DB.prepare(
        "INSERT INTO stocks(id,user_id,project_id,article_id) VALUES ('s','alice','alice-project','a')",
      ),
      app.env.DB.prepare(
        "INSERT INTO questions(id,stock_id,text,source,status,is_favorite) VALUES ('q','s','既存の問い','user','ready',1)",
      ),
      app.env.DB.prepare(
        "INSERT INTO pufu_scores(id,user_id,question_id,task,input_json,editor_version,status,score_json) VALUES ('pf','alice','q','課題','{}','0.9.14','ready','{}')",
      ),
      app.env.DB.prepare(
        "INSERT INTO pufu_phases(pufu_id,number,score_json,created_at,updated_at) VALUES ('pf',1,'{}','before','before')",
      ),
    ]);
    const before = await app.env.DB.prepare('SELECT * FROM questions').all();
    const scores = await app.env.DB.prepare('SELECT * FROM pufu_scores').all();
    const phases = await app.env.DB.prepare('SELECT * FROM pufu_phases').all();
    await applyMigration(app.env.DB, '0016_independent_questions.sql');
    expect((await app.env.DB.prepare('SELECT * FROM questions').all()).results).toEqual(
      before.results.map((q) => ({ ...q, project_id: 'alice-project' })),
    );
    expect((await app.env.DB.prepare('SELECT * FROM pufu_scores').all()).results).toEqual(
      scores.results,
    );
    expect((await app.env.DB.prepare('SELECT * FROM pufu_phases').all()).results).toEqual(
      phases.results,
    );
    await app.env.DB.prepare(
      "INSERT INTO questions(id,stock_id,status) VALUES ('ai','s','queued')",
    ).run();
    expect(
      await app.env.DB.prepare("SELECT project_id FROM questions WHERE id='ai'").first(),
    ).toEqual({ project_id: 'alice-project' });
    expect((await add({ stock_id: 's', project_id: 'alice-second' })).status).toBe(400);
    expect(
      (
        await app.request('/api/v1/stocks/s', {
          method: 'PATCH',
          body: { project_id: 'alice-second', note: '' },
        })
      ).status,
    ).toBe(200);
    expect(
      (await app.env.DB.prepare('SELECT project_id FROM questions').all()).results.every(
        (q) => q.project_id === 'alice-second',
      ),
    ).toBe(true);
    await app.request('/api/v1/stocks/s', { method: 'DELETE' });
    expect((await app.env.DB.prepare('SELECT * FROM questions').all()).results).toEqual([]);
    expect((await app.env.DB.prepare('SELECT * FROM pufu_scores').all()).results).toEqual([]);
    expect((await app.env.DB.prepare('SELECT * FROM pufu_phases').all()).results).toEqual([]);
  });
});
