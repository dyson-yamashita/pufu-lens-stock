import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { applyMigration, testApp } from './helpers';
import { searchBindings, searchStock } from './search-helpers';
import { syncSearchIndex } from '../server/search-index';
import { loadMemoryInputs } from '../server/memory';
import type { Project } from '../shared/domain';

describe('プロジェクトの全体一覧への表示設定', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
  });
  afterEach(async () => app.dispose());
  async function projects() {
    return ((await (await app.request('/api/v1/projects')).json()) as { projects: Project[] })
      .projects;
  }
  async function setting(enabled: boolean) {
    const response = await app.request('/api/v1/projects/alice-project', {
      method: 'PATCH',
      body: { name: 'Alice project', description: '', show_in_all_lists: enabled },
    });
    expect(response.status).toBe(200);
  }
  async function seed() {
    const hidden = await searchStock(app, 'hidden', { favorite: 1 });
    const visible = await searchStock(app, 'visible', { project: 'alice-second', favorite: 1 });
    await searchStock(app, 'foreign', { owner: 'bob', favorite: 1 });
    await app.env.DB.prepare(
      `INSERT INTO questions(id,project_id,stock_id,text,source,status,is_favorite) VALUES
        ('hidden-ai','alice-project',?,'レビューの問い','ai','ready',1),
        ('hidden-user','alice-project',NULL,'レビューの独立した問い','user','ready',1),
        ('visible-question','alice-second',NULL,'レビューの問い','user','ready',1),
        ('foreign-question','bob-project',NULL,'レビューの問い','user','ready',1)`,
    )
      .bind(hidden)
      .run();
    await setting(false);
    return { hidden, visible };
  }

  it('新規・既存はオンで、オフを保存し、省略した編集でも維持する', async () => {
    expect((await projects()).every((project) => project.show_in_all_lists === true)).toBe(true);
    for (const value of [undefined, false]) {
      const created = await app.request('/api/v1/projects', {
        method: 'POST',
        body: { name: '新規', show_in_all_lists: value },
      });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };
      expect((await projects()).find((project) => project.id === id)?.show_in_all_lists).toBe(
        value ?? true,
      );
    }
    await setting(false);
    expect(
      (
        await app.request('/api/v1/projects/alice-project', {
          method: 'PATCH',
          body: { name: '名前だけ編集' },
        })
      ).status,
    ).toBe(200);
    expect((await projects()).find((project) => project.id === 'alice-project')).toMatchObject({
      name: '名前だけ編集',
      show_in_all_lists: false,
      include_in_user_memory: true,
    });
    await setting(true);
    expect(
      (await projects()).find((project) => project.id === 'alice-project')?.show_in_all_lists,
    ).toBe(true);
    expect(
      (
        await app.request('/api/v1/projects/bob-project', {
          method: 'PATCH',
          body: { name: '変更', show_in_all_lists: false },
        })
      ).status,
    ).toBe(404);
  });

  it.each(['false', 0, null])('真偽値以外を拒否する: %j', async (show_in_all_lists) => {
    for (const method of ['POST', 'PATCH'])
      expect(
        (
          await app.request(`/api/v1/projects${method === 'PATCH' ? '/alice-project' : ''}`, {
            method,
            body: { name: '変更', show_in_all_lists },
          })
        ).status,
      ).toBe(400);
  });

  it('移行時に既存のプロジェクトを保持し、オンを初期値にする', async () => {
    await app.dispose();
    app = await testApp({
      migrations: (await readdir(new URL('../migrations/', import.meta.url)))
        .filter((filename) => filename.endsWith('.sql') && filename < '0024')
        .sort(),
      projectListVisibilityMigration: false,
    });
    const before = await app.env.DB.prepare('SELECT * FROM projects ORDER BY id').all();
    await applyMigration(app.env.DB, '0024_project_list_visibility.sql');
    expect((await app.env.DB.prepare('SELECT * FROM projects ORDER BY id').all()).results).toEqual(
      before.results.map((project) => ({ ...project, show_in_all_lists: 1 })),
    );
    expect((await projects()).every((project) => project.show_in_all_lists === true)).toBe(true);
  });

  it('全体一覧・検索・お気に入りの結果と件数から除外し、指定時と詳細では取得できる', async () => {
    const { hidden, visible } = await seed();
    for (const query of ['', '?q=レビュー&favorite=true&status=ready']) {
      const stocks = (await (await app.request('/api/v1/stocks' + query)).json()) as {
        stocks: { id: string }[];
      };
      expect(stocks).toMatchObject({ stocks: [{ id: visible }], total: 1, has_more: false });
      expect(stocks.stocks).toHaveLength(1);
      const questions = (await (await app.request('/api/v1/questions' + query)).json()) as {
        questions: { id: string }[];
      };
      expect(questions).toMatchObject({ questions: [{ id: 'visible-question' }], total: 1 });
      expect(questions.questions).toHaveLength(1);
    }
    expect(await (await app.request('/api/v1/stocks?page=2&limit=1')).json()).toMatchObject({
      stocks: [],
      total: 1,
      has_more: false,
    });
    expect(await (await app.request('/api/v1/questions?page=2')).json()).toMatchObject({
      questions: [],
      total: 1,
    });
    expect(
      await (await app.request('/api/v1/stocks?project_id=alice-project')).json(),
    ).toMatchObject({ stocks: [{ id: hidden }], total: 1 });
    const scopedQuestions = (await (
      await app.request('/api/v1/questions?project_id=alice-project')
    ).json()) as { total: number; questions: { id: string }[] };
    expect(scopedQuestions.total).toBe(2);
    expect(new Set(scopedQuestions.questions.map((q: { id: string }) => q.id))).toEqual(
      new Set(['hidden-ai', 'hidden-user']),
    );
    expect((await app.request(`/api/v1/stocks/${hidden}`)).status).toBe(200);
    expect((await app.request('/api/v1/questions/hidden-user')).status).toBe(200);
    expect((await projects()).find((project) => project.id === 'alice-project')).toMatchObject({
      show_in_all_lists: false,
      count: 1,
      question_count: 2,
    });
    await setting(true);
    expect(await (await app.request('/api/v1/stocks')).json()).toMatchObject({ total: 2 });
    expect(await (await app.request('/api/v1/questions')).json()).toMatchObject({ total: 3 });
  });

  it('意味検索・ハイブリッド検索でも全体から除外し、指定時は検索できる', async () => {
    const bindings = searchBindings(app.env);
    const { hidden, visible } = await seed();
    await syncSearchIndex(app.env);
    for (const mode of ['semantic', 'hybrid']) {
      const result = (await (
        await app.request(`/api/v1/stocks?q=レビュー&mode=${mode}`)
      ).json()) as { stocks: { id: string }[]; search: Record<string, unknown> };
      expect(result).toMatchObject({ stocks: [{ id: visible }], total: 1 });
      expect(result.stocks).toHaveLength(1);
      expect(result.search).toMatchObject({ mode, indexed_count: 1, pending_count: 0 });
      expect(
        await (
          await app.request(`/api/v1/stocks?q=レビュー&mode=${mode}&project_id=alice-project`)
        ).json(),
      ).toMatchObject({ stocks: [{ id: hidden }], total: 1 });
    }
    expect(bindings.query).toHaveBeenCalledTimes(4);
  });

  it('表示設定だけではメモリ更新を起動せず、メモリの対象も変えない', async () => {
    await searchStock(app, 'memory');
    const before = await app.env.DB.batch([
      app.env.DB.prepare('SELECT id,memory_revision FROM projects ORDER BY id'),
      app.env.DB.prepare('SELECT id,memory_revision FROM users ORDER BY id'),
      app.env.DB.prepare('SELECT * FROM processing_jobs ORDER BY id'),
    ]);
    const inputs = await loadMemoryInputs(app.env, 'alice', null);
    await setting(false);
    expect(await loadMemoryInputs(app.env, 'alice', null)).toEqual(inputs);
    const after = await app.env.DB.batch([
      app.env.DB.prepare('SELECT id,memory_revision FROM projects ORDER BY id'),
      app.env.DB.prepare('SELECT id,memory_revision FROM users ORDER BY id'),
      app.env.DB.prepare('SELECT * FROM processing_jobs ORDER BY id'),
    ]);
    expect(after.map((result) => result.results)).toEqual(before.map((result) => result.results));
  });
});
