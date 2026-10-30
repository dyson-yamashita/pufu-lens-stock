import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Response as CacheResponse } from 'miniflare';
import { testApp } from './helpers';

describe('公開プロジェクト一覧のキャッシュ', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  let cache: Pick<Cache, 'match' | 'put'>;
  const directory = (query = '', headers: Record<string, string> = { Cookie: '' }) =>
    app.request(`/api/public/projects${query}`, { headers });

  beforeEach(async () => {
    app = await testApp();
    const store = await (await app.getCaches()).open('public-project-directory');
    // Node標準のRequest/ResponseをMiniflareのRPCで扱える型へ変換し、保存・失効は実Cache APIに任せる。
    cache = {
      match: async (key) => {
        const hit = await store.match(new Request(key).url);
        return hit
          ? new Response(await hit.arrayBuffer(), { headers: Array.from(hit.headers) })
          : undefined;
      },
      put: async (key, response) =>
        store.put(
          new Request(key).url,
          new CacheResponse(await response.arrayBuffer(), {
            headers: Array.from(response.headers),
          }),
        ),
    };
    vi.stubGlobal('caches', { open: async () => cache });
    await app.env.DB.batch([
      app.env.DB.prepare(
        "UPDATE projects SET is_public=1,public_id='public-alice',public_description='公開する説明',published_at='2026-10-30' WHERE id='alice-project'",
      ),
      app.env.DB.prepare(
        "INSERT INTO articles (id,user_id,canonical_url,source_url,title,domain,status) VALUES ('article','alice','https://example.com/a','https://example.com/a','記事','example.com','ready'),('article-b','alice','https://example.com/b','https://example.com/b','記事B','example.com','ready')",
      ),
      app.env.DB.prepare(
        "INSERT INTO stocks (id,user_id,project_id,article_id) VALUES ('stock','alice','alice-project','article')",
      ),
      app.env.DB.prepare(
        "INSERT INTO questions (id,project_id,source,text,status) VALUES ('question','alice-project','user','公開する問い','ready')",
      ),
    ]);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await app.dispose();
  });

  it('暖まった一覧は件数集計を再実行せず返し、ブラウザには保存させない', async () => {
    const first = await directory();
    expect(first.status).toBe(200);
    const expected = await first.json();
    app.env.DB = {
      prepare: app.env.DB.prepare.bind(app.env.DB),
      batch: async () => {
        throw new Error('集計クエリを再実行した');
      },
    } as unknown as D1Database;
    const cached = await directory('?page=1');
    expect(cached.status).toBe(200);
    expect(await cached.json()).toEqual(expected);
    expect(cached.headers.get('Cache-Control')).toBe('no-store');
    expect(cached.headers.get('Content-Type')).toContain('application/json');
    expect(cached.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it.each([
    ['非公開化', "UPDATE projects SET is_public=0 WHERE id='alice-project'"],
    ['プロジェクト削除', "DELETE FROM projects WHERE id='alice-project'"],
    ['退会の連鎖削除', "DELETE FROM users WHERE id='alice'"],
  ])('%s後は、他拠点に旧キャッシュが残っていても一覧に表示しない', async (_, sql) => {
    expect(await (await directory()).json()).toMatchObject({ total: 1 });
    // 失効は拠点内のdeleteではなくDB側のrevisionで決まる。
    await app.env.DB.prepare(sql).run();
    expect(await (await directory()).json()).toMatchObject({ total: 0, items: [] });
  });

  it.each([
    [
      '名前と公開紹介文',
      "UPDATE projects SET name='更新した名前',public_description='更新した紹介文' WHERE id='alice-project'",
      { name: '更新した名前', public_description: '更新した紹介文' },
    ],
    [
      'ストック追加',
      "INSERT INTO stocks (id,user_id,project_id,article_id) VALUES ('second','alice','alice-project','article-b')",
      { stock_count: 2 },
    ],
    ['ストック削除', "DELETE FROM stocks WHERE id='stock'", { stock_count: 0 }],
    [
      'ストック移動',
      "UPDATE stocks SET project_id='alice-second' WHERE id='stock'",
      { stock_count: 0 },
    ],
    [
      '問い追加',
      "INSERT INTO questions (id,project_id,source,text,status) VALUES ('second','alice-project','user','新しい問い','ready')",
      { question_count: 2 },
    ],
    ['問い削除', "DELETE FROM questions WHERE id='question'", { question_count: 0 }],
    [
      '問い移動',
      "UPDATE questions SET project_id='alice-second' WHERE id='question'",
      { question_count: 0 },
    ],
    [
      '未完成の問い',
      "UPDATE questions SET status='generating' WHERE id='question'",
      { question_count: 0 },
    ],
  ])('%sをキャッシュの期限前に反映する', async (_, sql, expected) => {
    expect(await (await directory()).json()).toMatchObject({ total: 1 });
    await app.env.DB.prepare(sql).run();
    expect(await (await directory()).json()).toMatchObject({ items: [expected] });
  });

  it('キャッシュした空の一覧にも、新規公開・再公開と公開状態での新規作成を反映する', async () => {
    await app.env.DB.prepare("UPDATE projects SET is_public=0 WHERE id='alice-project'").run();
    expect(await (await directory()).json()).toMatchObject({ total: 0 });
    const publish = async (id: string) =>
      app.request(`/api/v1/projects/${id}/publication`, {
        method: 'PATCH',
        body: { is_public: true, public_description: '' },
      });
    expect((await publish('alice-project')).status).toBe(200);
    expect(await (await directory()).json()).toMatchObject({ total: 1 });
    expect((await publish('alice-second')).status).toBe(200);
    expect(await (await directory()).json()).toMatchObject({ total: 2 });
    await app.env.DB.prepare(
      "INSERT INTO projects (id,user_id,name,is_public,public_id,published_at) VALUES ('new-public','bob','新規公開',1,'public-bob','2026-10-30')",
    ).run();
    expect(await (await directory()).json()).toMatchObject({ total: 3 });
  });

  it('非公開プロジェクトから移動したストックと問いも一覧の件数に反映する', async () => {
    await app.env.DB.batch([
      app.env.DB.prepare("UPDATE stocks SET project_id='alice-second' WHERE id='stock'"),
      app.env.DB.prepare("UPDATE questions SET project_id='alice-second' WHERE id='question'"),
    ]);
    expect(await (await directory()).json()).toMatchObject({
      items: [{ stock_count: 0, question_count: 0 }],
    });
    await app.env.DB.batch([
      app.env.DB.prepare("UPDATE stocks SET project_id='alice-project' WHERE id='stock'"),
      app.env.DB.prepare("UPDATE questions SET project_id='alice-project' WHERE id='question'"),
    ]);
    expect(await (await directory()).json()).toMatchObject({
      items: [{ stock_count: 1, question_count: 1 }],
    });
  });

  it('再生成中のAIの問いは確定済み本文がある場合だけ数える', async () => {
    await app.env.DB.prepare("UPDATE questions SET status='generating' WHERE id='question'").run();
    expect(await (await directory()).json()).toMatchObject({ items: [{ question_count: 0 }] });
    await app.env.DB.prepare("UPDATE questions SET source='ai' WHERE id='question'").run();
    expect(await (await directory()).json()).toMatchObject({ items: [{ question_count: 1 }] });
    await app.env.DB.prepare("UPDATE questions SET text=NULL WHERE id='question'").run();
    expect(await (await directory()).json()).toMatchObject({ items: [{ question_count: 0 }] });
  });

  it('ページ・公開範囲を分離し、Cookieや任意クエリを共有内容に混ぜない', async () => {
    await app.env.DB.batch(
      Array.from({ length: 13 }, (_, i) =>
        app.env.DB.prepare(
          "INSERT INTO projects (id,user_id,name,is_public,public_id,published_at) VALUES (?,'bob',?,1,?,'2026-10-30')",
        ).bind(`extra-${i}`, `公開 ${i}`, `public-${String(i).padStart(2, '0')}`),
      ),
    );
    await app.env.DB.prepare(
      "UPDATE projects SET name='SECRET_PRIVATE',description='SECRET_DESCRIPTION' WHERE id='alice-second'",
    ).run();
    const page1 = await (await directory('?page=1&ignored=malicious')).json();
    const page2 = await (await directory('?page=2')).json();
    expect(page1).toMatchObject({ total: 14, page: 1, has_more: true });
    expect(page2).toMatchObject({ total: 14, page: 2, has_more: false });
    expect((page1 as { items: unknown[] }).items).toHaveLength(12);
    expect((page2 as { items: unknown[] }).items).toHaveLength(2);
    expect(await (await directory('', { Cookie: 'stock_session=bob-session' })).json()).toEqual(
      page1,
    );
    const text = JSON.stringify([page1, page2]);
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('user_id');
    expect(text).not.toContain('malicious');
    for (const value of ['0', '-1', '1.5', '5001'])
      expect((await directory(`?page=${value}`)).status).toBe(400);
    expect((await directory('/public-alice')).headers.get('Cache-Control')).toBe('no-store');
    expect((await app.request('/api/v1/projects')).headers.get('Cache-Control')).toBe('no-store');
  });

  it('キャッシュの投入が非公開化より遅れても、後続の取得で古い一覧を返さない', async () => {
    const put = cache.put.bind(cache);
    vi.spyOn(cache, 'put').mockImplementationOnce(async (key, response) => {
      await app.env.DB.prepare("UPDATE projects SET is_public=0 WHERE id='alice-project'").run();
      await put(key, response);
    });
    expect(await (await directory()).json()).toMatchObject({ total: 1 });
    expect(await (await directory()).json()).toMatchObject({ total: 0, items: [] });
  });

  it.each(['match', 'put'] as const)('キャッシュの%s障害時はDBから取得する', async (method) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(cache, method).mockRejectedValue(new Error('Cache API unavailable'));
    const response = await directory();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 1, items: [{ name: 'Alice project' }] });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('キャッシュを開けない場合もDBから取得する', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('caches', {
      open: async () => {
        throw new Error('Cache storage unavailable');
      },
    });
    const response = await directory();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 1 });
  });

  it('revisionを確認できないときは、暖まった旧キャッシュを返さない', async () => {
    expect((await directory()).status).toBe(200);
    await app.env.DB.prepare('DELETE FROM public_directory_revision').run();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await directory();
    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('Cache APIがない環境では従来どおりDBから取得する', async () => {
    vi.stubGlobal('caches', undefined);
    expect(await (await directory()).json()).toMatchObject({ total: 1 });
    await app.env.DB.prepare("UPDATE projects SET is_public=0 WHERE id='alice-project'").run();
    expect(await (await directory()).json()).toMatchObject({ total: 0, items: [] });
  });
});
