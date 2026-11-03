import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { applyMigration, mockEvent, mockStep, testApp } from './helpers';
import { queueQuestionStatements } from '../server/db';
import { dispatchJobs, scheduledMaintenance } from '../server/jobs';
import { admitJob, AiLimitError, deferLimitedJob } from '../server/usage';
import { ArticleWorkflow } from '../server/workflows';
import type { Job } from '../server/env';
import type { Project, Question, Stock } from '../shared/domain';

describe('プロジェクトごとの問いの自動生成設定', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
    app.env.LOCAL_DEMO_ENABLED = 'true';
  });
  afterEach(async () => {
    await app.dispose();
  });
  const projects = async () =>
    ((await (await app.request('/api/v1/projects')).json()) as { projects: Project[] }).projects;
  const update = (auto_generate_questions?: boolean) =>
    app.request('/api/v1/projects/alice-project', {
      method: 'PATCH',
      body: { name: 'Alice project', description: '', auto_generate_questions },
    });
  const save = async (input = {}, project_id = 'alice-project') => {
    const response = await app.request('/api/v1/stocks', {
      method: 'POST',
      body: { project_id, type: 'text', text: '非同期処理の再試行を安全に設計する。', ...input },
    });
    expect(response.status).toBe(202);
    return ((await response.json()) as { id: string }).id;
  };
  const questions = async (stockId: string) =>
    (
      (await (await app.request(`/api/v1/stocks/${stockId}/question`)).json()) as {
        questions: Question[];
      }
    ).questions;
  async function run(kind: string, targetId?: string) {
    const target =
      kind === 'article' && targetId
        ? (await app.env.DB.prepare('SELECT article_id FROM stocks WHERE id = ?')
            .bind(targetId)
            .first<{ article_id: string }>())!.article_id
        : targetId;
    const job = await app.env.DB.prepare(
      'SELECT * FROM processing_jobs WHERE kind = ? AND (? IS NULL OR target_id = ?) ORDER BY revision DESC LIMIT 1',
    )
      .bind(kind, target ?? null, target ?? null)
      .first<Job>();
    expect(job).not.toBeNull();
    await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(job!.id), mockStep());
  }

  it('既定値はオンで、作成・更新した設定を保存し、省略した更新ではオフを維持する', async () => {
    expect((await projects()).every((project) => project.auto_generate_questions === true)).toBe(
      true,
    );
    const off = await app.request('/api/v1/projects', {
      method: 'POST',
      body: { name: '自動生成なし', auto_generate_questions: false },
    });
    expect(off.status).toBe(201);
    const { id } = (await off.json()) as { id: string };
    expect((await projects()).find((project) => project.id === id)).toMatchObject({
      auto_generate_questions: false,
    });
    expect((await update(false)).status).toBe(200);
    expect((await update()).status).toBe(200);
    expect((await projects()).find((project) => project.id === 'alice-project')).toMatchObject({
      auto_generate_questions: false,
    });
    expect((await update(true)).status).toBe(200);
    expect((await projects()).find((project) => project.id === 'alice-project')).toMatchObject({
      auto_generate_questions: true,
    });
    const defaultProject = await app.request('/api/v1/projects', {
      method: 'POST',
      body: { name: '既定の設定' },
    });
    expect(defaultProject.status).toBe(201);
    const defaultId = ((await defaultProject.json()) as { id: string }).id;
    expect((await projects()).find((project) => project.id === defaultId)).toMatchObject({
      auto_generate_questions: true,
    });
  });

  it('設定の不正な型と他ユーザーによる変更を拒否する', async () => {
    for (const auto_generate_questions of [null, 0, 'false', {}]) {
      for (const method of ['POST', 'PATCH']) {
        const response = await app.request(
          method === 'POST' ? '/api/v1/projects' : '/api/v1/projects/alice-project',
          { method, body: { name: '変更', auto_generate_questions } },
        );
        expect(response.status).toBe(400);
      }
    }
    expect(
      (
        await app.request('/api/v1/projects/alice-project', {
          method: 'PATCH',
          user: 'bob',
          body: { name: '変更', auto_generate_questions: false },
        })
      ).status,
    ).toBe(404);
  });

  it('問いの設定を切り替えても既存の一覧表示・メモリ設定を保持する', async () => {
    const response = await app.request('/api/v1/projects/alice-project', {
      method: 'PATCH',
      body: {
        name: 'Alice project',
        description: '',
        show_in_all_lists: false,
        include_in_user_memory: false,
        auto_generate_questions: false,
      },
    });
    expect(response.status).toBe(200);
    await update(true);
    expect((await projects()).find((project) => project.id === 'alice-project')).toMatchObject({
      show_in_all_lists: false,
      include_in_user_memory: false,
      auto_generate_questions: true,
    });
  });

  it.each([
    { type: 'url', text: undefined, url: 'https://example.com/no-question' },
    { type: 'text', text: '自動で問いを作らないストック。' },
  ])('オフでは$typeの保存時も要約完了時も問いを登録しない', async (input) => {
    expect((await update(false)).status).toBe(200);
    const id = await save(input);
    expect(await questions(id)).toEqual([]);
    if (input.type === 'text') {
      await run('article', id);
      const detail = (await (await app.request(`/api/v1/stocks/${id}`)).json()) as { stock: Stock };
      expect(detail.stock.status).toBe('ready');
      expect(detail.stock.summary?.overview).toBeTruthy();
    } else {
      await app.env.DB.prepare("UPDATE articles SET status = 'ready'").run();
      await app.env.DB.batch(queueQuestionStatements(app.env));
    }
    await scheduledMaintenance(app.env);
    expect(await questions(id)).toEqual([]);
    expect(
      [
        ...new Set(
          (await app.env.DB.prepare('SELECT kind FROM processing_jobs').all()).results.map(
            (job) => job.kind,
          ),
        ),
      ].sort(),
    ).toEqual(['article', 'project_memory', 'user_memory']);
  });

  it('生成済みと手動の問いを保持し、同じ要約済み記事でも保存先の設定に従う', async () => {
    const first = await save();
    await run('article', first);
    await run('question', first);
    const before = await questions(first);
    expect(before[0].status).toBe('ready');
    await update(false);
    expect(await questions(first)).toEqual(before);
    const manual = await app.request('/api/v1/questions', {
      method: 'POST',
      body: { stock_id: first, text: '手動の問いを追加できる？' },
    });
    expect(manual.status).toBe(201);
    expect((await questions(first)).find((question) => question.source === 'user')?.text).toBe(
      '手動の問いを追加できる？',
    );
    const second = await save({}, 'alice-second');
    await run('question', second);
    expect((await questions(second))[0].status).toBe('ready');
    const offProject = await app.request('/api/v1/projects', {
      method: 'POST',
      body: { name: '要約済み記事の保存先', auto_generate_questions: false },
    });
    const offProjectId = ((await offProject.json()) as { id: string }).id;
    const readyStock = await save({}, offProjectId);
    expect(await questions(readyStock)).toEqual([]);
    const offStock = await save({ text: '別の記事。' });
    await run('article', offStock);
    expect(await questions(offStock)).toEqual([]);
    await update(true);
    const resumedStock = await save({ text: 'オンに戻した後の記事。' });
    await run('article', resumedStock);
    await run('question', resumedStock);
    expect((await questions(resumedStock))[0].status).toBe('ready');
  });

  it('オフにすると未開始の問いジョブを待機させ、オンに戻すと再開する', async () => {
    const id = await save();
    await app.env.DB.prepare("UPDATE articles SET status = 'ready', summary_json = ?")
      .bind(JSON.stringify({ overview: '概要', keyPoints: ['要点'], topics: ['話題'] }))
      .run();
    await app.env.DB.batch(queueQuestionStatements(app.env, id));
    await update(false);
    await scheduledMaintenance(app.env);
    expect(
      await app.env.DB.prepare(
        "SELECT status FROM processing_jobs WHERE kind = 'question'",
      ).first(),
    ).toEqual({ status: 'pending' });
    expect((await questions(id))[0].status).toBe('queued');
    await update(true);
    expect(
      await app.env.DB.prepare(
        "SELECT status FROM processing_jobs WHERE kind = 'question'",
      ).first(),
    ).toEqual({ status: 'dispatched' });
    await run('question', id);
    expect((await questions(id))[0].status).toBe('ready');
  });

  it('予約済みの問いをオフで待機させても要約の実行枠を塞がず、日次利用量は保持する', async () => {
    await save();
    await save({ text: '2件目の問いの生成元。' });
    await app.env.DB.prepare("UPDATE processing_jobs SET status = 'done'").run();
    await app.env.DB.prepare("UPDATE articles SET status = 'ready'").run();
    await app.env.DB.batch(queueQuestionStatements(app.env));
    app.env.AI_CONCURRENT_JOBS = '2';
    const jobs = await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE kind = 'question'",
    ).all<Job>();
    expect(jobs.results).toHaveLength(2);
    for (const job of jobs.results) {
      expect(await admitJob(app.env, job)).toBe(true);
      await deferLimitedJob(
        app.env,
        job,
        new AiLimitError(new Date(Date.now() + 60000).toISOString()),
      );
    }
    await update(false);
    await app.env.DB.prepare(
      "UPDATE processing_jobs SET status = 'done' WHERE kind != 'question'",
    ).run();
    const id = await save({ text: '停止中の問いに妨げられずに要約する記事。' });
    expect(
      await app.env.DB.prepare(
        "SELECT j.status FROM processing_jobs j JOIN stocks s ON s.article_id = j.target_id WHERE j.kind = 'article' AND s.id = ?",
      )
        .bind(id)
        .first(),
    ).toEqual({ status: 'dispatched' });
    expect(
      (await app.env.DB.prepare("SELECT id FROM ai_operations WHERE kind = 'question'").all())
        .results,
    ).toHaveLength(2);
    expect(
      (await app.env.DB.prepare("SELECT status FROM processing_jobs WHERE kind = 'question'").all())
        .results,
    ).toEqual([{ status: 'pending' }, { status: 'pending' }]);
  });

  it('ディスパッチの一覧取得後にオフへ変わっても未開始の問いを起動しない', async () => {
    const id = await save();
    await app.env.DB.prepare("UPDATE processing_jobs SET status = 'done'").run();
    await app.env.DB.prepare("UPDATE articles SET status = 'ready'").run();
    await app.env.DB.batch(queueQuestionStatements(app.env, id));
    await app.env.DB.prepare(
      "INSERT INTO processing_jobs (id,user_id,kind,target_id,revision) VALUES ('toggle-before-question','alice','cleanup','unused',1)",
    ).run();
    app.env.ARTICLE_WORKFLOW = {
      create: async ({ id: jobId }: { id: string }) => {
        if (jobId === 'toggle-before-question')
          await app.env.DB.prepare(
            "UPDATE projects SET auto_generate_questions = 0 WHERE id = 'alice-project'",
          ).run();
        return { id: jobId };
      },
    } as unknown as typeof app.env.ARTICLE_WORKFLOW;
    await dispatchJobs(app.env);
    expect(
      await app.env.DB.prepare(
        "SELECT status FROM processing_jobs WHERE kind = 'question'",
      ).first(),
    ).toEqual({ status: 'pending' });
  });

  it.each(['alice-project', 'alice-second'])(
    '短文のメモ変更や移動でも保存先%sがオフなら生成済みの問いを保持する',
    async (projectId) => {
      const id = await save();
      await run('article', id);
      await run('question', id);
      const [before] = await questions(id);
      const setting = await app.request(`/api/v1/projects/${projectId}`, {
        method: 'PATCH',
        body: { name: '保存先', auto_generate_questions: false },
      });
      expect(setting.status).toBe(200);
      const edited = await app.request(`/api/v1/stocks/${id}`, {
        method: 'PATCH',
        body: { project_id: projectId, note: '問いを保持したままメモを更新する。' },
      });
      expect(edited.status).toBe(200);
      expect((await questions(id))[0]).toMatchObject({
        id: before.id,
        text: before.text,
        status: 'ready',
        project_id: projectId,
      });
    },
  );

  it('オンに戻した問いは予約履歴があっても同時実行枠を取り直す', async () => {
    await save();
    await save({ text: '再開する2件目の問い。' });
    await app.env.DB.prepare("UPDATE processing_jobs SET status = 'done'").run();
    await app.env.DB.prepare("UPDATE articles SET status = 'ready'").run();
    await app.env.DB.batch(queueQuestionStatements(app.env));
    app.env.AI_CONCURRENT_JOBS = '2';
    const jobs = await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE kind = 'question'",
    ).all<Job>();
    for (const job of jobs.results) expect(await admitJob(app.env, job)).toBe(true);
    await update(false);
    for (const id of ['active-article-1', 'active-article-2'])
      await app.env.DB.batch([
        app.env.DB.prepare(
          "INSERT INTO processing_jobs (id,user_id,kind,target_id,revision,status) VALUES (?,'alice','article','unused',1,'dispatched')",
        ).bind(id),
        app.env.DB.prepare(
          "INSERT INTO ai_operations (id,user_id,kind) VALUES (?,'alice','article')",
        ).bind(id),
      ]);
    await update(true);
    expect(
      (
        await app.env.DB.prepare(
          "SELECT kind FROM processing_jobs WHERE status = 'dispatched'",
        ).all()
      ).results,
    ).toEqual([{ kind: 'article' }, { kind: 'article' }]);
    await app.env.DB.prepare(
      "UPDATE processing_jobs SET status = 'done' WHERE kind = 'article'",
    ).run();
    await app.env.DB.prepare('DELETE FROM ai_deferrals').run();
    await dispatchJobs(app.env);
    expect(
      (
        await app.env.DB.prepare(
          "SELECT kind FROM processing_jobs WHERE status = 'dispatched'",
        ).all()
      ).results,
    ).toEqual([{ kind: 'question' }, { kind: 'question' }]);
    expect(
      (await app.env.DB.prepare("SELECT id FROM ai_operations WHERE kind = 'question'").all())
        .results,
    ).toHaveLength(2);
  });

  it('移行で既存のプロジェクト・ストック・問い・ジョブを保持し、自動生成をオンにする', async () => {
    await app.dispose();
    const migrations = (await readdir(new URL('../migrations/', import.meta.url)))
      .filter((filename) => filename.endsWith('.sql') && filename < '0027')
      .sort();
    app = await testApp({ migrations, projectQuestionSettingsMigration: false });
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO articles (id,user_id,canonical_url,source_url,title,domain) VALUES ('old-article','alice','https://example.com/old','https://example.com/old','既存記事','example.com')",
      ),
      app.env.DB.prepare(
        "INSERT INTO stocks (id,user_id,project_id,article_id) VALUES ('old-stock','alice','alice-project','old-article')",
      ),
      app.env.DB.prepare(
        "INSERT INTO questions (id,project_id,stock_id,text,status) VALUES ('old-question','alice-project','old-stock','既存の問い？','ready')",
      ),
      app.env.DB.prepare(
        "INSERT INTO processing_jobs (id,user_id,kind,target_id,revision) VALUES ('old-job','alice','article','old-article',1)",
      ),
    ]);
    const beforeProjects = await app.env.DB.prepare('SELECT * FROM projects ORDER BY id').all();
    const tables = ['stocks', 'questions', 'processing_jobs'];
    const before = await app.env.DB.batch(
      tables.map((table) => app.env.DB.prepare(`SELECT * FROM ${table}`)),
    );
    await applyMigration(app.env.DB, '0027_project_question_settings.sql');
    expect((await app.env.DB.prepare('SELECT * FROM projects ORDER BY id').all()).results).toEqual(
      beforeProjects.results.map((project) => ({ ...project, auto_generate_questions: 1 })),
    );
    for (const [index, table] of tables.entries())
      expect((await app.env.DB.prepare(`SELECT * FROM ${table}`).all()).results).toEqual(
        before[index].results,
      );
    await expect(
      app.env.DB.prepare('UPDATE projects SET auto_generate_questions = 2').run(),
    ).rejects.toThrow();
  });
});
