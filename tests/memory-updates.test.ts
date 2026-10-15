import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryWorkflow } from '../server/workflows';
import { testApp, mockEvent, mockStep } from './helpers';
import type { Job } from '../server/env';
import type { MemoryData } from '../shared/domain';

describe('メモリの差分更新と反映状況', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  const inputs: Record<string, unknown>[] = [];
  const run = vi.fn(async (_model: string, options: { messages: { content: string }[] }) => {
    const input = JSON.parse(options.messages[1].content);
    inputs.push(input);
    const sources = input.addedSources ?? input.sources ?? [];
    return {
      response: {
        interests: ['収集した知識'],
        knowledge: [
          ...(input.currentMemory?.knowledge ?? []),
          ...(input.fragments?.flatMap((fragment: MemoryData) => fragment.knowledge) ?? []),
          ...sources.map((source: { articleId: string; title: string }) => ({
            text: source.title,
            articleIds: [source.articleId],
          })),
        ].slice(-12),
        questions: [],
      },
    };
  });
  beforeEach(async () => {
    app = await testApp();
    app.env.AI = { run };
    inputs.length = 0;
    run.mockClear();
  });
  afterEach(async () => app.dispose());

  async function ready(title: string, project_id = 'alice-project') {
    const response = await app.request('/api/v1/stocks', {
      method: 'POST',
      body: { type: 'text', project_id, title, text: `${title}についての記事本文。` },
    });
    expect(response.status).toBe(202);
    const { id } = (await response.json()) as { id: string };
    const stock = (await app.env.DB.prepare('SELECT article_id FROM stocks WHERE id=?')
      .bind(id)
      .first<{ article_id: string }>())!;
    await app.env.DB.prepare("UPDATE articles SET status='ready',summary_json=? WHERE id=?")
      .bind(
        JSON.stringify({ overview: `${title}の要約。`, keyPoints: [title], topics: ['設計'] }),
        stock.article_id,
      )
      .run();
    return { id, articleId: stock.article_id };
  }
  async function memory(projectId: string | null = 'alice-project') {
    return (await (
      await app.request(`/api/v1/memory${projectId ? `?project_id=${projectId}` : ''}`)
    ).json()) as {
      memory: { revision: number; article_count: number; data: MemoryData } | null;
      coverage: {
        ready_count: number;
        reflected_count: number;
        pending_count: number;
        waiting_count: number;
        full_rebuild_reason: string | null;
      };
    };
  }
  async function execute(projectId: string | null = 'alice-project') {
    const job = (await app.env.DB.prepare(
      'SELECT * FROM processing_jobs WHERE kind=? AND target_id=? ORDER BY revision DESC,created_at DESC LIMIT 1',
    )
      .bind(projectId ? 'project_memory' : 'user_memory', projectId ?? 'alice')
      .first<Job>())!;
    await new MemoryWorkflow(app.ctx, app.env).run(mockEvent(job.id), mockStep());
    return job;
  }
  const rebuild = (mode: string, request_id = crypto.randomUUID()) =>
    app.request('/api/v1/memory/rebuild', {
      method: 'POST',
      body: { project_id: 'alice-project', mode, request_id },
    });

  it('追加分だけを既存メモリへ統合し、プロジェクトとユーザーの履歴を独立に保存する', async () => {
    const old = await ready('以前の記事');
    await execute();
    const added = await ready('新しい記事');
    inputs.length = 0;
    await execute();
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      currentMemory: { knowledge: [{ articleIds: [old.articleId] }] },
      addedSources: [{ articleId: added.articleId }],
    });
    expect(JSON.stringify(inputs[0])).not.toContain('以前の記事の要約');
    expect((await memory()).coverage).toMatchObject({
      ready_count: 2,
      reflected_count: 2,
      pending_count: 0,
      waiting_count: 0,
    });
    expect((await memory(null)).coverage).toMatchObject({ reflected_count: 0, pending_count: 2 });
    await execute(null);
    expect((await memory(null)).coverage).toMatchObject({ reflected_count: 2, pending_count: 0 });
    expect((await memory()).memory!.data.knowledge).toHaveLength(2);
  });

  it('未反映分がなければ差分再生成でAIを呼ばない', async () => {
    await ready('反映済み');
    await execute();
    const previous = (await memory()).memory;
    expect((await rebuild('incremental')).status).toBe(202);
    inputs.length = 0;
    await execute();
    expect(inputs).toEqual([]);
    expect((await memory()).memory!.data).toEqual(previous!.data);
  });

  it('差分更新後もデモのトピック件数を全取り込み記事から集計する', async () => {
    app.env.AI = undefined;
    app.env.LOCAL_DEMO_ENABLED = 'true';
    await ready('最初の設計記事');
    await execute();
    await ready('追加の設計記事');
    await execute();
    expect((await memory()).memory!.data.interests).toEqual([
      '「設計」に関する記事を2件収集しています。',
    ]);
  });

  it('手動の全件更新は反映済み記事も入力し、同じIDの異なるモードを拒否する', async () => {
    const first = await ready('最初の記事');
    await execute();
    const second = await ready('次の記事');
    const requestId = crypto.randomUUID();
    expect((await rebuild('full', requestId)).status).toBe(202);
    expect((await rebuild('full', requestId)).status).toBe(202);
    expect((await rebuild('incremental', requestId)).status).toBe(409);
    inputs.length = 0;
    await execute();
    expect(inputs[0].currentMemory).toBeUndefined();
    expect((inputs[0].sources as { articleId: string }[]).map((s) => s.articleId).sort()).toEqual(
      [first.articleId, second.articleId].sort(),
    );
    expect((await rebuild('invalid')).status).toBe(400);
  });

  it.each([
    { projectId: 'alice-project', mode: 'incremental' },
    { projectId: 'alice-project', mode: 'full' },
    { projectId: null, mode: 'incremental' },
    { projectId: null, mode: 'full' },
  ])(
    '手動再生成は選択したメモリだけを更新する: $projectId / $mode',
    async ({ projectId, mode }) => {
      await ready('反映済みの記事');
      await execute();
      await execute(null);
      await app.env.DB.prepare("UPDATE processing_jobs SET status='done'").run();
      const otherProjectId = projectId ? null : 'alice-project';
      const previous = await memory(otherProjectId);
      const response = await app.request('/api/v1/memory/rebuild', {
        method: 'POST',
        body: { project_id: projectId, mode, request_id: crypto.randomUUID() },
      });
      expect(response.status).toBe(202);
      const jobs = await app.env.DB.prepare(
        "SELECT kind,target_id FROM processing_jobs WHERE status!='done'",
      ).all();
      expect(jobs.results).toEqual([
        { kind: projectId ? 'project_memory' : 'user_memory', target_id: projectId ?? 'alice' },
      ]);
      await execute(projectId);
      expect(await memory(otherProjectId)).toEqual(previous);
    },
  );

  it.each(['delete', 'note', 'move', 'profile'] as const)(
    '%sで既存内容が変わったら全件更新する',
    async (change) => {
      const first = await ready('変更される記事');
      await ready('残る記事');
      await execute();
      if (change === 'delete')
        await app.request(`/api/v1/stocks/${first.id}`, { method: 'DELETE' });
      if (change === 'note' || change === 'move')
        await app.request(`/api/v1/stocks/${first.id}`, {
          method: 'PATCH',
          body: {
            note: '変更したメモ',
            project_id: change === 'move' ? 'alice-second' : 'alice-project',
          },
        });
      if (change === 'profile')
        await app.request('/api/v1/projects/alice-project', {
          method: 'PATCH',
          body: { name: 'Alice project', description: '新しい目的' },
        });
      expect((await memory()).coverage.full_rebuild_reason).toBeTruthy();
      inputs.length = 0;
      await execute();
      expect(inputs[0].currentMemory).toBeUndefined();
      expect(inputs[0].sources).toHaveLength(change === 'delete' || change === 'move' ? 1 : 2);
      expect((await memory()).coverage.full_rebuild_reason).toBeNull();
    },
  );

  it('生成失敗では既存メモリと履歴を保持し、再試行で未反映分を取り込む', async () => {
    await ready('反映済み');
    await execute();
    const previous = (await memory()).memory;
    await ready('失敗後に再試行する記事');
    run.mockResolvedValueOnce({
      response: { interests: Array(9).fill('不正'), knowledge: [], questions: [] },
    });
    await expect(execute()).rejects.toThrow('AIの出力形式');
    expect((await memory()).memory).toMatchObject({
      revision: previous!.revision,
      article_count: previous!.article_count,
      data: previous!.data,
    });
    expect((await memory()).coverage).toMatchObject({ reflected_count: 1, pending_count: 1 });
    await rebuild('incremental');
    await execute();
    expect((await memory()).coverage).toMatchObject({ reflected_count: 2, pending_count: 0 });
  });

  it('生成中に追加されると古い結果を履歴へ保存せず、最新要求でまとめて取り込む', async () => {
    await ready('反映済み');
    await execute();
    await ready('生成開始前の記事');
    const original = run.getMockImplementation()!;
    run.mockImplementationOnce(async (...args) => {
      await ready('生成中に追加した記事');
      return original(...args);
    });
    await execute();
    expect((await memory()).memory!.article_count).toBe(1);
    expect((await memory()).coverage).toMatchObject({ reflected_count: 1, pending_count: 2 });
    await execute();
    expect((await memory()).memory!.article_count).toBe(3);
    expect((await memory()).coverage).toMatchObject({ reflected_count: 3, pending_count: 0 });
  });

  it('明示した全件更新を後続のストック追加に集約しても差分へ弱めない', async () => {
    await ready('反映済み');
    await execute();
    await rebuild('full');
    await ready('後から追加');
    inputs.length = 0;
    await execute();
    expect(inputs[0].currentMemory).toBeUndefined();
    expect(inputs[0].sources).toHaveLength(2);
  });

  it('既存メモリに反映履歴がない場合は全件更新で履歴を確立する', async () => {
    await ready('旧データの記事');
    await app.env.DB.prepare(
      "INSERT INTO memories(id,user_id,project_id,revision,text,data_json,article_count,model) VALUES('project-alice-project','alice','alice-project',0,'旧メモリ',?,1,'old')",
    )
      .bind(JSON.stringify({ interests: ['旧データ'], knowledge: [], questions: [] }))
      .run();
    expect((await memory()).coverage.full_rebuild_reason).toBeTruthy();
    await execute();
    expect((await memory()).coverage).toMatchObject({
      reflected_count: 1,
      pending_count: 0,
      full_rebuild_reason: null,
    });
  });

  it('利用枠待ちでは未反映のまま保持し、枠が回復したら取り込む', async () => {
    await ready('反映済み');
    await execute();
    app.env.AI_CALL_DAILY_LIMIT = '1';
    await ready('枠の回復待ち');
    inputs.length = 0;
    await execute();
    expect(inputs).toEqual([]);
    expect((await memory()).coverage).toMatchObject({ reflected_count: 1, pending_count: 1 });
    await app.env.DB.prepare("UPDATE ai_attempts SET created_at='2000-01-01'").run();
    await execute();
    expect((await memory()).coverage).toMatchObject({ reflected_count: 2, pending_count: 0 });
    expect(await memory()).toMatchObject({ error: null });
  });

  it('最後の記事の削除後は空メモリと空履歴を確定し、移行前と混同しない', async () => {
    const stock = await ready('最後の記事');
    await execute();
    await app.request(`/api/v1/stocks/${stock.id}`, { method: 'DELETE' });
    inputs.length = 0;
    await execute();
    expect(inputs).toEqual([]);
    expect((await memory()).memory!.data).toEqual({ interests: [], knowledge: [], questions: [] });
    expect((await memory()).coverage).toMatchObject({
      reflected_count: 0,
      pending_count: 0,
      full_rebuild_reason: null,
    });
  });

  it('25件を超えても省略された知識を含め全記事の取り込みを追跡し、要約未完了は数え分ける', async () => {
    app.env.AI_MEMORY_DAILY_LIMIT = '1000';
    for (let index = 0; index < 26; index++) await ready(`記事${index}`);
    await app.request('/api/v1/stocks', {
      method: 'POST',
      body: { type: 'text', project_id: 'alice-project', text: 'まだ要約していない本文' },
    });
    await execute();
    expect((await memory()).memory!.data.knowledge.length).toBeLessThanOrEqual(12);
    expect((await memory()).coverage).toMatchObject({
      ready_count: 26,
      reflected_count: 26,
      pending_count: 0,
      waiting_count: 1,
    });
    const other = await app.request('/api/v1/memory', { user: 'bob' });
    expect(await other.json()).toMatchObject({ coverage: { ready_count: 0, reflected_count: 0 } });
  });

  it('128件の長い要約も各永続ステップを1MiB以内に保って全件取り込む', async () => {
    const summary = JSON.stringify({
      overview: '概'.repeat(1600),
      keyPoints: Array(8).fill('点'.repeat(500)),
      topics: ['設計'],
    });
    const statements: D1PreparedStatement[] = [];
    for (let index = 0; index < 128; index++) {
      const id = `large-${index.toString().padStart(3, '0')}`;
      statements.push(
        app.env.DB.prepare(
          "INSERT INTO articles(id,user_id,canonical_url,source_url,title,domain,status,summary_json) VALUES(?,'alice',?,'',?,'','ready',?)",
        ).bind(id, id, id, summary),
        app.env.DB.prepare(
          "INSERT INTO stocks(id,user_id,project_id,article_id) VALUES(?,'alice','alice-project',?)",
        ).bind(id, id),
      );
    }
    await app.env.DB.batch(statements);
    await app.env.DB.prepare(
      "INSERT INTO processing_jobs(id,user_id,kind,target_id,revision) VALUES('large-memory','alice','project_memory','alice-project',0)",
    ).run();
    await new MemoryWorkflow(app.ctx, app.env).run(mockEvent('large-memory'), mockStep(2 ** 20));
    expect((await memory()).memory!.article_count).toBe(128);
    expect((await memory()).coverage).toMatchObject({ reflected_count: 128, pending_count: 0 });
  });

  it('1100件の反映状況をリクエスト当たり50回のDB呼び出し以内で取得する', async () => {
    await app.env.DB.batch([
      app.env.DB.prepare(
        `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1100)
        INSERT INTO articles(id,user_id,canonical_url,source_url,title,domain,status,summary_json)
        SELECT 'history-'||x,'alice','history-'||x,'','記事'||x,'','ready',? FROM n`,
      ).bind(JSON.stringify({ overview: '要約', keyPoints: ['知識'], topics: ['設計'] })),
      app.env.DB.prepare(`INSERT INTO stocks(id,user_id,project_id,article_id,created_at)
        SELECT 'stock-'||id,'alice','alice-project',id,'2000-01-01' FROM articles WHERE user_id='alice'`),
    ]);
    let queries = 0;
    const prepare = app.env.DB.prepare.bind(app.env.DB);
    const limited = (statement: D1PreparedStatement): D1PreparedStatement =>
      new Proxy(statement, {
        get(target, property) {
          if (property === 'bind') return (...args: unknown[]) => limited(target.bind(...args));
          const value = Reflect.get(target, property, target);
          if (typeof value !== 'function') return value;
          return (...args: unknown[]) => {
            if (['first', 'all', 'run', 'raw'].includes(String(property)) && ++queries > 50)
              throw new Error('Too many D1 queries');
            return value.apply(target, args);
          };
        },
      });
    app.env.DB = new Proxy(app.env.DB, {
      get(target, property) {
        if (property === 'prepare') return (sql: string) => limited(prepare(sql));
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const response = await app.request('/api/v1/memory');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      coverage: { ready_count: 1100, pending_count: 1100 },
    });
  });
});
