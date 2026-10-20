import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testApp } from './helpers';

describe('ストックの検索モード', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
  });
  afterEach(async () => {
    await app.dispose();
  });

  it('未設定のhybridはkeywordへ戻った理由を返し、AIを呼び出さない', async () => {
    const run = vi.fn(async () => ({ data: [] }));
    app.env.AI = { run };
    const response = await app.request('/api/v1/stocks?q=開発&mode=hybrid');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      search: {
        requested_mode: 'hybrid',
        mode: 'keyword',
        fallback_reason: 'not_configured',
      },
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('明示したsemanticが未設定なら成功として扱わない', async () => {
    const response = await app.request('/api/v1/stocks?q=開発&mode=semantic');
    expect(response.status).toBe(503);
  });

  it('未知のmodeを拒否する', async () => {
    expect((await app.request('/api/v1/stocks?q=開発&mode=unknown')).status).toBe(400);
  });
});

import { syncSearchIndex } from '../server/search-index';
import { searchBindings, searchStock, searchEntry } from './search-helpers';
import { requestAccountDeletion } from '../server/account';
import { applyMigration } from './helpers';
import { readdir } from 'node:fs/promises';

describe('実D1を使うハイブリッド検索と索引同期', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  let bindings: ReturnType<typeof searchBindings>;
  beforeEach(async () => {
    app = await testApp();
    bindings = searchBindings(app.env);
  });
  afterEach(async () => {
    await app.dispose();
  });
  const data = async (query: string) => {
    const response = await app.request('/api/v1/stocks?' + query);
    expect(response.status).toBe(200);
    return (await response.json()) as {
      stocks: { id: string; summary?: unknown }[];
      total: number;
      has_more: boolean;
      search: Record<string, unknown>;
    };
  };
  async function indexed() {
    const id = await searchStock(app, 'first');
    await syncSearchIndex(app.env);
    return id;
  }

  it('keywordと空のqはAIもVectorizeも呼ばず、索引は本文を含まない', async () => {
    await indexed();
    expect(bindings.run.mock.calls[0][0]).toBe('@cf/baai/bge-m3');
    expect(bindings.run.mock.calls[0][1]).toMatchObject({ truncate_inputs: true });
    const input = bindings.run.mock.calls[0][1] as { text: string[] };
    expect(input.text[0]).toContain('要点の検索対象');
    expect(input.text[0]).toContain('トピックの検索対象');
    expect(input.text[0]).toContain('保存したメモ');
    expect(input.text[0]).not.toContain('本文限定の秘密語');
    bindings.run.mockClear();
    await data('q=レビュー');
    const empty = await data('q=%20&mode=semantic');
    expect(empty.search).toMatchObject({ mode: 'keyword', fallback_reason: 'empty_query' });
    expect(empty.total).toBe(1);
    expect(bindings.run).not.toHaveBeenCalled();
    expect(bindings.query).not.toHaveBeenCalled();
  });
  it('語句に一致しない候補も返しRRFで重複を排除し、関連度順にページングする', async () => {
    const direct = await searchStock(app, 'direct', { title: '品質管理' });
    const related = await searchStock(app, 'related');
    await syncSearchIndex(app.env);
    bindings.query.mockResolvedValue({
      matches: [
        { id: await searchEntry(app.env, related), score: 0.9 },
        { id: await searchEntry(app.env, direct), score: 0.7 },
      ],
      count: 2,
    });
    const first = await data('q=品質管理&mode=hybrid&limit=1&order=asc');
    expect(first).toMatchObject({
      stocks: [{ id: direct }],
      total: 2,
      has_more: true,
      sort_by: 'relevance',
      order: 'desc',
    });
    const second = await data('q=品質管理&mode=hybrid&limit=1&page=2&detail=compact');
    expect(second.stocks.map((item) => item.id)).toEqual([related]);
    expect(second.search).toMatchObject({
      mode: 'hybrid',
      total_scope: 'candidates',
      candidate_limit: 100,
    });
    expect(bindings.query.mock.calls[0][1]).toMatchObject({
      namespace: 'alice',
      topK: 100,
      returnMetadata: 'none',
    });
    expect((await data('q=品質管理&mode=semantic&min_score=0.95')).stocks).toEqual([]);
    expect((await app.request('/api/v1/stocks?q=x&mode=hybrid&min_score=2')).status).toBe(400);
  });
  it('Vectorizeが他人・別プロジェクト・不明IDを返してもD1で除外する', async () => {
    const own = await indexed();
    const otherProject = await searchStock(app, 'second', { project: 'alice-second' });
    const otherOwner = await searchStock(app, 'bob', { owner: 'bob' });
    await syncSearchIndex(app.env);
    bindings.query.mockResolvedValue({
      matches: [own, otherProject, otherOwner].map((_, i) => ({ id: 'unused' + i, score: 0.9 })),
      count: 3,
    });
    bindings.query.mockResolvedValue({
      matches: [
        { id: await searchEntry(app.env, otherOwner), score: 1 },
        { id: await searchEntry(app.env, otherProject), score: 0.99 },
        { id: 'unknown', score: 0.98 },
        { id: await searchEntry(app.env, own), score: 0.9 },
      ],
      count: 4,
    });
    const result = await data('q=開発の品質&mode=semantic&project_id=alice-project');
    expect(result.stocks.map((item) => item.id)).toEqual([own]);
    expect(result.total).toBe(1);
    expect(bindings.query.mock.calls.at(-1)![1]?.filter).toEqual({ project_id: 'alice-project' });
    bindings.run.mockClear();
    expect(
      (await app.request('/api/v1/stocks?q=x&mode=semantic&project_id=bob-project')).status,
    ).toBe(404);
    expect(
      (await app.request('/api/v1/stocks?q=x&mode=semantic', { headers: { Cookie: '' } })).status,
    ).toBe(401);
    expect(bindings.run).not.toHaveBeenCalled();
  });
  it.each([
    ['favorite=true', 'favorite'],
    ['source=web', 'web'],
    ['source=user', 'favorite'],
    ['status=failed', 'failed'],
  ])('最新の絞り込みをD1で適用する: %s', async (filter, expected) => {
    await searchStock(app, 'favorite', { favorite: 1 });
    await searchStock(app, 'web', { source: 'url' });
    await searchStock(app, 'failed', { source: 'url', status: 'failed' });
    await syncSearchIndex(app.env);
    const result = await data('q=品質保証&mode=semantic&' + filter);
    const ids = result.stocks.map((item) => item.id);
    expect(ids).toContain('s-' + expected);
    if (filter === 'source=web') expect(ids).not.toContain('s-favorite');
    else expect(ids).toEqual(['s-' + expected]);
  });
  it('検索中の編集で古い世代を無効化し、古いVectorize候補を返さない', async () => {
    const id = await indexed();
    const old = await searchEntry(app.env, id);
    bindings.query.mockImplementationOnce(async () => {
      await app.env.DB.prepare('UPDATE stocks SET note=? WHERE id=?').bind('新しいメモ', id).run();
      return { matches: [{ id: old, score: 1 }], count: 1 };
    });
    expect((await data('q=関連情報&mode=semantic')).stocks).toEqual([]);
    await syncSearchIndex(app.env);
    expect(bindings.vectors.has(old)).toBe(false);
    expect(bindings.vectors.has(await searchEntry(app.env, id))).toBe(true);
  });
  it('同時同期は1回だけ埋め込み、タイトル・メモ・保存先変更を次世代へ反映する', async () => {
    const id = await searchStock(app, 'first');
    await Promise.all([syncSearchIndex(app.env), syncSearchIndex(app.env)]);
    expect(bindings.upsert).toHaveBeenCalledOnce();
    const old = await searchEntry(app.env, id);
    await app.request('/api/v1/stocks/' + id + '/title', {
      method: 'PATCH',
      body: { title: '更新したタイトル' },
    });
    await app.request('/api/v1/stocks/' + id, {
      method: 'PATCH',
      body: { note: '更新したメモ', project_id: 'alice-second' },
    });
    await syncSearchIndex(app.env);
    const next = await searchEntry(app.env, id);
    expect(next).not.toBe(old);
    expect(bindings.vectors.has(old)).toBe(false);
    expect(bindings.vectors.get(next)?.metadata).toEqual({ project_id: 'alice-second' });
    expect(JSON.stringify(bindings.run.mock.calls.at(-1))).toContain('更新したタイトル');
    expect(JSON.stringify(bindings.run.mock.calls.at(-1))).toContain('更新したメモ');
  });
  it.each(['stock', 'project', 'account'])('削除後もベクトルを削除できる: %s', async (kind) => {
    const id = await indexed();
    const entry = await searchEntry(app.env, id);
    if (kind === 'stock') await app.request('/api/v1/stocks/' + id, { method: 'DELETE' });
    if (kind === 'project')
      await app.request('/api/v1/projects/alice-project', { method: 'DELETE' });
    if (kind === 'account') await requestAccountDeletion(app.env, 'alice');
    await syncSearchIndex(app.env);
    expect(bindings.vectors.has(entry)).toBe(false);
    expect(
      await app.env.DB.prepare('SELECT id FROM stock_search_entries WHERE stock_id=?')
        .bind(id)
        .first(),
    ).toBeNull();
  });
  it('重なるCronが選択済みの要求を先に完了しても二重にembeddingしない', async () => {
    await searchStock(app, 'parallel-one');
    await searchStock(app, 'parallel-two');
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    bindings.run.mockImplementationOnce(async () => {
      entered();
      await gate;
      return { data: [bindings.values] };
    });
    const first = syncSearchIndex(app.env);
    try {
      await started;
      await syncSearchIndex(app.env);
    } finally {
      release();
      await first;
    }
    expect(bindings.upsert).toHaveBeenCalledTimes(2);
    expect(bindings.run).toHaveBeenCalledTimes(2);
  });
  it.each(['削除後', '削除の応答待ち中'] as const)(
    'タイムアウト後にupsertが%sに完了しても削除要求を失わない',
    async (timing) => {
      const id = await searchStock(app, 'timeout');
      const entry = await searchEntry(app.env, id);
      let complete!: () => void;
      const gate = new Promise<void>((resolve) => {
        complete = resolve;
      });
      bindings.upsert.mockImplementationOnce(async (items) => {
        await gate;
        for (const item of items) bindings.vectors.set(item.id, item);
        return { mutationId: crypto.randomUUID() };
      });
      const original = globalThis.setTimeout;
      const timer = vi
        .spyOn(globalThis, 'setTimeout')
        .mockImplementation((operation, delay, ...args) =>
          original(operation, delay === 15000 ? 20 : delay, ...args),
        );
      try {
        await syncSearchIndex(app.env);
        timer.mockRestore();
        await app.request('/api/v1/stocks/' + id, { method: 'DELETE' });
        await app.env.DB.prepare(
          "UPDATE stock_search_entries SET next_attempt_at='2000-01-01'",
        ).run();
        const settle = async () => {
          complete();
          await bindings.upsert.mock.results[0].value;
          await vi.waitFor(async () =>
            expect(
              await app.env.DB.prepare('SELECT write_pending FROM stock_search_entries WHERE id=?')
                .bind(entry)
                .first(),
            ).toMatchObject({ write_pending: 0 }),
          );
        };
        if (timing === '削除の応答待ち中') {
          bindings.deleteByIds.mockImplementationOnce(async (ids) => {
            for (const id of ids) bindings.vectors.delete(id);
            await settle();
            return { mutationId: crypto.randomUUID() };
          });
        }
        await syncSearchIndex(app.env);
        expect(bindings.deleteByIds).toHaveBeenCalledWith([entry]);
        expect(
          await app.env.DB.prepare('SELECT write_pending FROM stock_search_entries WHERE id=?')
            .bind(entry)
            .first(),
        ).toMatchObject({ write_pending: timing === '削除後' ? 1 : 0 });
        if (timing === '削除後') await settle();
        expect(bindings.vectors.has(entry)).toBe(true);
        await syncSearchIndex(app.env);
        expect(bindings.vectors.has(entry)).toBe(false);
        expect(
          await app.env.DB.prepare('SELECT id FROM stock_search_entries WHERE id=?')
            .bind(entry)
            .first(),
        ).toBeNull();
      } finally {
        timer.mockRestore();
        complete();
      }
    },
  );
  it('削除とupsertが競合し削除APIが一度失敗しても要求を保持して再試行する', async () => {
    const id = await searchStock(app, 'first');
    bindings.upsert.mockImplementationOnce(async (items) => {
      await app.env.DB.prepare('DELETE FROM stocks WHERE id=?').bind(id).run();
      for (const item of items) bindings.vectors.set(item.id, item);
      return { mutationId: crypto.randomUUID() };
    });
    await syncSearchIndex(app.env);
    expect(bindings.vectors.size).toBe(1);
    bindings.deleteByIds.mockRejectedValueOnce(new Error('temporary'));
    await syncSearchIndex(app.env);
    expect(
      (await app.env.DB.prepare('SELECT COUNT(*) AS count FROM stock_search_entries').first())!
        .count,
    ).toBe(1);
    await app.env.DB.prepare("UPDATE stock_search_entries SET next_attempt_at='2000-01-01'").run();
    await syncSearchIndex(app.env);
    expect(bindings.vectors.size).toBe(0);
  });
  it('壊れた埋め込み・Vectorize障害を成功した意味検索として扱わずAI枠を解放する', async () => {
    await indexed();
    bindings.run.mockResolvedValueOnce({ data: [[1]] });
    expect((await app.request('/api/v1/stocks?q=関連&mode=semantic')).status).toBe(503);
    bindings.query.mockRejectedValueOnce(new Error('provider failure'));
    const fallback = await data('q=レビュー&mode=hybrid');
    expect(fallback.search).toMatchObject({ mode: 'keyword', fallback_reason: 'service_error' });
    expect(fallback.stocks).toHaveLength(1);
    expect(
      (await app.env.DB.prepare(
        "SELECT COUNT(*) AS count FROM ai_calls WHERE status='running'",
      ).first())!.count,
    ).toBe(0);
  });
  it('検索の日次枠を原子的に制限し、上限後は追加AIを呼ばない', async () => {
    await indexed();
    app.env.AI_SEARCH_DAILY_LIMIT = '1';
    bindings.run.mockClear();
    const results = await Promise.all([
      app.request('/api/v1/stocks?q=関連&mode=semantic'),
      app.request('/api/v1/stocks?q=別の関連&mode=semantic'),
    ]);
    expect(results.map((item) => item.status).sort()).toEqual([200, 429]);
    const fallback = await data('q=レビュー&mode=hybrid');
    expect(fallback.search).toMatchObject({ mode: 'keyword', fallback_reason: 'rate_limited' });
    expect(bindings.run).toHaveBeenCalledOnce();
  });
  it('索引未完成はkeywordへ戻り、生成中の記事ではembeddingを開始しない', async () => {
    const id = await searchStock(app, 'pending', { status: 'summarizing' });
    await syncSearchIndex(app.env);
    expect(bindings.run).not.toHaveBeenCalled();
    expect((await data('q=レビュー&mode=hybrid')).search).toMatchObject({
      mode: 'keyword',
      fallback_reason: 'index_pending',
    });
    await app.env.DB.prepare("UPDATE articles SET status='ready' WHERE id='pending'").run();
    await syncSearchIndex(app.env);
    expect((await data('q=品質&mode=semantic')).stocks.map((item) => item.id)).toEqual([id]);
  });
  it('索引用の日次枠と既存のAI全体枠を共有して費用を制限する', async () => {
    app.env.AI_INDEX_DAILY_LIMIT = '1';
    await searchStock(app, 'one');
    await searchStock(app, 'two');
    await syncSearchIndex(app.env);
    expect(bindings.upsert).toHaveBeenCalledOnce();
    expect(
      (await app.env.DB.prepare(
        'SELECT COUNT(*) AS count FROM stock_search_entries WHERE current=1 AND ready=0',
      ).first())!.count,
    ).toBe(1);
    bindings.run.mockClear();
    app.env.AI_CALL_DAILY_LIMIT = '1';
    expect((await app.request('/api/v1/stocks?q=品質&mode=semantic')).status).toBe(429);
    expect(bindings.run).not.toHaveBeenCalled();
    expect((await data('q=レビュー')).total).toBe(2);
  });
  it('100候補を複数回のD1照合で安全に扱い、件数の打ち切りを明示する', async () => {
    await app.env.DB.batch([
      app.env.DB
        .prepare(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<85)
        INSERT INTO articles(id,user_id,canonical_url,source_url,title,domain,status)
        SELECT 'bulk-'||n,'alice','https://example.com/'||n,'https://example.com/'||n,'関連資料 '||n,'example.com','ready' FROM seq`),
      app.env.DB.prepare(`INSERT INTO stocks(id,user_id,project_id,article_id)
        SELECT 's-'||id,'alice','alice-project',id FROM articles WHERE id LIKE 'bulk-%'`),
      app.env.DB.prepare('UPDATE stock_search_entries SET ready=1,touched=1'),
    ]);
    const rows = (
      await app.env.DB.prepare('SELECT id FROM stock_search_entries ORDER BY id').all<{
        id: string;
      }>()
    ).results;
    bindings.query.mockResolvedValue({
      matches: [
        ...rows.map((row) => ({ id: row.id, score: 0.9 })),
        ...Array.from({ length: 15 }, (_, i) => ({ id: 'unknown-' + i, score: 0.9 })),
      ],
      count: 100,
    });
    const ids = new Set<string>();
    for (let page = 1; page <= 4; page++) {
      const result = await data('q=意味による情報&mode=semantic&page=' + page);
      result.stocks.forEach((item) => ids.add(item.id));
      expect(result.total).toBe(85);
      expect(result.search.candidates_truncated).toBe(true);
    }
    expect(ids.size).toBe(85);
  });
  it('要約完了の変更を索引へ反映し、初回migrationで既存ストックも対象にする', async () => {
    const files = (await readdir(new URL('../migrations/', import.meta.url)))
      .filter((file) => file.endsWith('.sql') && !file.startsWith('0023'))
      .sort();
    await app.dispose();
    app = await testApp({ migrations: files });
    bindings = searchBindings(app.env);
    const id = await searchStock(app, 'legacy');
    await applyMigration(app.env.DB, '0023_stock_search.sql');
    await syncSearchIndex(app.env);
    const old = await searchEntry(app.env, id);
    await app.env.DB.prepare('UPDATE articles SET summary_json=? WHERE id=?')
      .bind(
        JSON.stringify({
          overview: '新しい要約',
          keyPoints: ['新しい要点'],
          topics: ['新しい話題'],
        }),
        'legacy',
      )
      .run();
    await syncSearchIndex(app.env);
    expect(await searchEntry(app.env, id)).not.toBe(old);
    expect(JSON.stringify(bindings.run.mock.calls.at(-1))).toContain('新しい要約');
  });
});
