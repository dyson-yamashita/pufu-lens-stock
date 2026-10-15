import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './helpers';

describe('ストックの保存先指定', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
  });
  afterEach(async () => {
    await app.dispose();
  });
  const inputs = [
    { url: 'https://example.com/shared' },
    { type: 'text', text: 'すべての保存先で参照する本文です。' },
  ];
  const save = (body: object, headers = {}) =>
    app.request('/api/v1/stocks', { method: 'POST', body, headers });
  async function bearer(project_id?: string) {
    const response = await app.request('/api/v1/tokens', {
      method: 'POST',
      body: { name: '共有用', project_id },
    });
    expect(response.status).toBe(201);
    const { token } = (await response.json()) as { token: string };
    return { Authorization: `Bearer ${token}`, Cookie: '', Origin: '' };
  }
  const stocks = async () =>
    (
      await app.env.DB.prepare(
        'SELECT id, project_id, article_id, note FROM stocks ORDER BY project_id',
      ).all<{ id: string; project_id: string; article_id: string; note: string }>()
    ).results;

  it.each(inputs)('限定トークンの保存先を省略時に使う: %j', async (input) => {
    const headers = await bearer('alice-project');
    const response = await save(input, headers);
    expect(response.status).toBe(202);
    const { id } = (await response.json()) as { id: string };
    expect(await stocks()).toEqual([expect.objectContaining({ id, project_id: 'alice-project' })]);
    const duplicate = await save({ ...input, project_id: 'alice-project' }, headers);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ id, duplicate: true });
  });

  it.each(inputs)('限定トークンと異なる指定先を保存前に拒否する: %j', async (input) => {
    const headers = await bearer('alice-project');
    const response = await save({ ...input, project_id: 'alice-second' }, headers);
    expect(response.status).toBe(403);
    expect(await stocks()).toEqual([]);
  });

  it.each(inputs)('限定なしトークンの省略時は本人の全プロジェクトに保存する: %j', async (input) => {
    const response = await save({ ...input, note: '共有メモ' }, await bearer());
    expect(response.status).toBe(202);
    const { id } = (await response.json()) as { id: string };
    const saved = await stocks();
    expect(saved.map((stock) => stock.project_id)).toEqual(['alice-project', 'alice-second']);
    expect(saved.some((stock) => stock.id === id)).toBe(true);
    expect(new Set(saved.map((stock) => stock.article_id)).size).toBe(1);
    expect(saved.map((stock) => stock.note)).toEqual(['共有メモ', '共有メモ']);
    const questions = await app.env.DB.prepare('SELECT stock_id FROM questions').all<{
      stock_id: string;
    }>();
    expect(questions.results.map((q) => q.stock_id).sort()).toEqual(
      saved.map((stock) => stock.id).sort(),
    );
    const jobs = await app.env.DB.prepare('SELECT kind FROM processing_jobs').all<{
      kind: string;
    }>();
    expect(jobs.results.filter((job) => job.kind === 'article')).toHaveLength(1);
    const projects = await app.env.DB.prepare(
      'SELECT id, memory_revision FROM projects ORDER BY id',
    ).all();
    expect(projects.results).toEqual([
      { id: 'alice-project', memory_revision: 1 },
      { id: 'alice-second', memory_revision: 1 },
      { id: 'bob-project', memory_revision: 0 },
    ]);
  });

  it('セッション認証でも省略時は本人の全プロジェクトに保存する', async () => {
    expect((await save(inputs[0])).status).toBe(202);
    expect((await stocks()).map((stock) => stock.project_id)).toEqual([
      'alice-project',
      'alice-second',
    ]);
  });

  it('限定なしトークンで明示した保存先だけに保存し、他ユーザーの保存先を拒否する', async () => {
    const headers = await bearer();
    expect((await save({ ...inputs[0], project_id: 'bob-project' }, headers)).status).toBe(404);
    expect((await save({ ...inputs[0], project_id: 'alice-second' }, headers)).status).toBe(202);
    expect((await stocks()).map((stock) => stock.project_id)).toEqual(['alice-second']);
  });

  it('全件保存で既存のストックとメモを保持し、新しい保存先だけ更新する', async () => {
    expect(
      (await save({ ...inputs[0], project_id: 'alice-project', note: '元のメモ' })).status,
    ).toBe(202);
    const response = await save({ ...inputs[0], note: '新しいメモ' }, await bearer());
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ duplicate: false });
    const saved = await stocks();
    expect(saved.map((stock) => [stock.project_id, stock.note])).toEqual([
      ['alice-project', '元のメモ'],
      ['alice-second', '新しいメモ'],
    ]);
    expect(new Set(saved.map((stock) => stock.article_id)).size).toBe(1);
    const projects = await app.env.DB.prepare(
      "SELECT memory_revision FROM projects WHERE user_id = 'alice' ORDER BY id",
    ).all<{ memory_revision: number }>();
    expect(projects.results.map((p) => p.memory_revision)).toEqual([1, 1]);
    expect((await save(inputs[0], await bearer())).status).toBe(200);
  });

  it('全件保存の並行再送と保存先追加後の再送で二重保存・二重計上しない', async () => {
    const headers = { ...(await bearer()), 'Idempotency-Key': 'all-projects' };
    const responses = await Promise.all(Array.from({ length: 3 }, () => save(inputs[0], headers)));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 202]);
    const results = (await Promise.all(responses.map((response) => response.json()))) as {
      id: string;
    }[];
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    await app.request('/api/v1/projects', { method: 'POST', body: { name: '保存後に追加' } });
    const replay = await save(inputs[0], headers);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ id: results[0].id, duplicate: true });
    expect(await stocks()).toHaveLength(2);
    expect(
      (await app.env.DB.prepare('SELECT COUNT(*) AS n FROM stock_usage').first<{ n: number }>())!.n,
    ).toBe(2);
    expect((await save({ ...inputs[0], note: '変更' }, headers)).status).toBe(409);
    expect((await save({ ...inputs[0], project_id: 'alice-project' }, headers)).status).toBe(409);
    await app.request(`/api/v1/stocks/${results[0].id}`, { method: 'DELETE' });
    expect((await save(inputs[0], headers)).status).toBe(409);
  });

  it('保存先が0件の場合はエラーにして記事も保存しない', async () => {
    const headers = await bearer();
    await app.env.DB.prepare("DELETE FROM projects WHERE user_id = 'alice'").run();
    const response = await save(inputs[0], headers);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('プロジェクト') });
    expect((await app.env.DB.prepare('SELECT id FROM articles').all()).results).toEqual([]);
  });

  it.each(['', null, 1])('不正なproject_idを全件保存として扱わない: %j', async (project_id) => {
    expect((await save({ ...inputs[0], project_id }, await bearer())).status).toBe(400);
    expect(await stocks()).toEqual([]);
  });

  it('全件分の保存枠が足りない場合は全体をロールバックし、枠回復後に再送できる', async () => {
    await app.env.DB.prepare(
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<199) INSERT INTO stock_usage (stock_id,user_id) SELECT 'used-' || i,'alice' FROM n",
    ).run();
    const headers = { ...(await bearer()), 'Idempotency-Key': 'all-quota' };
    const blocked = await save(inputs[0], headers);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
    expect(await stocks()).toEqual([]);
    for (const table of ['articles', 'questions', 'processing_jobs', 'idempotency_keys']) {
      expect((await app.env.DB.prepare(`SELECT * FROM ${table}`).all()).results).toEqual([]);
    }
    expect(
      (await app.env.DB.prepare('SELECT COUNT(*) AS n FROM stock_usage').first<{ n: number }>())!.n,
    ).toBe(199);
    await app.env.DB.prepare("DELETE FROM stock_usage WHERE stock_id='used-1'").run();
    expect((await save(inputs[0], headers)).status).toBe(202);
    expect(await stocks()).toHaveLength(2);
    expect(
      (await app.env.DB.prepare('SELECT COUNT(*) AS n FROM stock_usage').first<{ n: number }>())!.n,
    ).toBe(200);
  });
});
