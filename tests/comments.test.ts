import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './helpers';
import { mcpToken } from './mcp-helpers';
import worker from '../server/index';
import imageScore from './fixtures/pufu-sparse.json';

type Target = { target_type: 'stock' | 'question' | 'pufu'; target_id: string; phase?: number };
type Comment = Target & { id: string; body: string; author_id: string; created_at: string };
describe('本人用の時系列コメント', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  const stock: Target = { target_type: 'stock', target_id: 'stock' };
  const question: Target = { target_type: 'question', target_id: 'question' };
  const pufu: Target = { target_type: 'pufu', target_id: 'pufu', phase: 1 };
  const add = (target: Target, body = '判断の理由', options = {}) =>
    app.request('/api/v1/comments', {
      method: 'POST',
      body: { ...target, body, request_id: crypto.randomUUID() },
      ...options,
    });
  const list = (target: Target, options = {}, page = 1) =>
    app.request(
      `/api/v1/comments?${new URLSearchParams({ ...target, phase: target.phase?.toString() ?? '', page: String(page) })}`,
      options,
    );
  beforeEach(async () => {
    app = await testApp();
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO articles(id,user_id,canonical_url,source_url,title,domain,status) VALUES ('article','alice','https://example.com','https://example.com','記事','example.com','ready')",
      ),
      app.env.DB.prepare(
        "INSERT INTO stocks(id,user_id,project_id,article_id) VALUES ('stock','alice','alice-project','article')",
      ),
      app.env.DB.prepare(
        "INSERT INTO questions(id,stock_id,project_id,source,text,status) VALUES ('question','stock','alice-project','user','問い','ready'),('independent',NULL,'alice-second','user','独立した問い','ready')",
      ),
      app.env.DB.prepare(
        "INSERT INTO pufu_scores(id,user_id,question_id,task,input_json,editor_version,status,current_phase) VALUES ('pufu','alice','question','課題','{}','0.9.19','ready',2)",
      ),
      app.env.DB.prepare(
        "INSERT INTO pufu_phases(pufu_id,number,score_json,created_at,updated_at) VALUES ('pufu',1,'{}','2026-10-01','2026-10-01'),('pufu',2,'{}','2026-10-02','2026-10-02')",
      ),
    ]);
  });
  afterEach(async () => {
    await app.dispose();
  });

  it('対象ごとに作成者・日時と本文を保存し、古い順に50件ずつ返す', async () => {
    for (const target of [stock, question, pufu, { ...pufu, phase: 2 }]) {
      const response = await add(target, '  最初の判断\n次の行  ');
      expect(response.status).toBe(201);
      const { comment } = (await response.json()) as { comment: Comment };
      expect(comment).toMatchObject({
        ...target,
        body: '最初の判断\n次の行',
        author_id: 'alice',
        author_kind: 'user',
      });
      expect(Number.isNaN(Date.parse(comment.created_at))).toBe(false);
      expect(await (await list(target)).json()).toMatchObject({
        comments: [comment],
        has_more: false,
      });
    }
    await app.env.DB.batch(
      Array.from({ length: 51 }, (_, i) =>
        app.env.DB.prepare(
          "INSERT INTO comments(id,target_type,target_id,body,author_id,created_at) VALUES (?,'stock','stock',?,'alice',?)",
        ).bind(
          `page-${String(i).padStart(2, '0')}`,
          `履歴${i}`,
          `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
        ),
      ),
    );
    const first = (await (await list(stock)).json()) as { comments: Comment[]; has_more: boolean };
    expect(first.comments).toHaveLength(50);
    expect(first.comments[0].body).toBe('履歴0');
    expect(first.comments[49].body).toBe('履歴49');
    expect(first.has_more).toBe(true);
    expect(await (await list(stock, {}, 2)).json()).toMatchObject({
      comments: [{ body: '履歴50' }, { body: '最初の判断\n次の行' }],
      has_more: false,
    });
  });

  it('同じrequest_idの再送は1件になり、異なる本文や対象での使い回しは競合する', async () => {
    const data = { ...stock, body: '同じ記録', request_id: crypto.randomUUID() };
    const post = (body: unknown) => app.request('/api/v1/comments', { method: 'POST', body });
    expect((await post(data)).status).toBe(201);
    expect((await post(data)).status).toBe(200);
    expect((await post({ ...data, body: '別の記録' })).status).toBe(409);
    expect((await post({ ...data, ...question })).status).toBe(409);
    expect(await (await list(stock)).json()).toMatchObject({
      comments: [{ body: '同じ記録' }],
      has_more: false,
    });
  });

  it('空白や長過ぎる本文・不正な局面を拒否し、存在しない局面には保存しない', async () => {
    for (const body of ['', ' \n ', '長'.repeat(2001)])
      expect((await add(stock, body)).status).toBe(400);
    for (const target of [
      { ...stock, phase: 1 },
      { ...pufu, phase: undefined },
      { ...pufu, phase: 0 },
    ])
      expect((await add(target)).status).toBe(400);
    expect((await add({ ...pufu, phase: 3 })).status).toBe(404);
    expect((await list({ ...pufu, phase: 3 })).status).toBe(404);
  });

  it('別の利用者・未認証・異なるOriginからの書き込みを拒否する', async () => {
    expect((await add(stock)).status).toBe(201);
    for (const target of [stock, question, pufu]) {
      expect((await add(target, '他人', { user: 'bob' })).status).toBe(404);
      expect((await list(target, { user: 'bob' })).status).toBe(404);
      expect((await add({ ...target, target_id: 'missing' })).status).toBe(404);
    }
    expect((await list(stock, { headers: { Cookie: '' } })).status).toBe(401);
    expect(
      (await add(stock, 'CSRF', { headers: { Origin: 'https://evil.example.com' } })).status,
    ).toBe(403);
  });

  it('削除対象だけのコメントを消し、関連先のコメントはプロジェクト・ユーザー削除まで保持する', async () => {
    const independent: Target = { target_type: 'question', target_id: 'independent' };
    const retained = [question, pufu, { ...pufu, phase: 2 }, independent];
    for (const target of [stock, ...retained]) expect((await add(target)).status).toBe(201);
    const comments = async (target: Target) =>
      (await (await list(target)).json()) as {
        comments: Comment[];
      };
    const before = await Promise.all(retained.map(comments));
    expect((await app.request('/api/v1/stocks/stock', { method: 'DELETE' })).status).toBe(200);
    expect((await app.env.DB.prepare('SELECT COUNT(*) AS n FROM comments').first())!.n).toBe(4);
    expect(await Promise.all(retained.map(comments))).toEqual(before);
    expect((await app.request('/api/v1/questions/question', { method: 'DELETE' })).status).toBe(
      200,
    );
    expect((await app.env.DB.prepare('SELECT COUNT(*) AS n FROM comments').first())!.n).toBe(3);
    expect(await Promise.all(retained.slice(1).map(comments))).toEqual(before.slice(1));
    await app.env.DB.prepare("DELETE FROM projects WHERE id='alice-project'").run();
    expect((await app.env.DB.prepare('SELECT target_id FROM comments').all()).results).toEqual([
      { target_id: 'independent' },
    ]);
    await app.env.DB.prepare("DELETE FROM users WHERE id='alice'").run();
    expect((await app.env.DB.prepare('SELECT * FROM comments').all()).results).toEqual([]);
  });

  it('公開した対象にもコメントを公開せず、匿名で共通APIを読めない', async () => {
    for (const target of [stock, question, pufu])
      expect((await add(target, 'SECRET_PRIVATE_COMMENT')).status).toBe(201);
    await app.env.DB.batch([
      app.env.DB.prepare("UPDATE pufu_scores SET score_json=? WHERE id='pufu'").bind(
        JSON.stringify(imageScore),
      ),
      app.env.DB.prepare("UPDATE pufu_phases SET score_json=? WHERE pufu_id='pufu'").bind(
        JSON.stringify(imageScore),
      ),
    ]);
    const response = await app.request('/api/v1/projects/alice-project/publication', {
      method: 'PATCH',
      body: { is_public: true, public_description: '' },
    });
    const { publication } = (await response.json()) as { publication: { public_id: string } };
    for (const suffix of [
      '',
      '/stocks',
      '/stocks/stock',
      '/questions',
      '/questions/question',
      '/pufus/pufu',
    ]) {
      const publicResponse = await app.request(
        `/api/public/projects/${publication.public_id}${suffix}`,
        { headers: { Cookie: '' } },
      );
      expect(publicResponse.status).toBe(200);
      expect(await publicResponse.text()).not.toContain('SECRET_PRIVATE_COMMENT');
    }
    expect((await list(pufu, { headers: { Cookie: '' } })).status).toBe(401);
  });

  async function call(token: string, name: string, args: unknown) {
    const response = await worker.fetch(
      new Request(`${app.env.APP_URL}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Host: new URL(app.env.APP_URL).host,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      }),
      app.env,
      app.ctx,
    );
    const raw = await response.text();
    expect(response.status, raw).toBe(200);
    const message = response.headers.get('Content-Type')?.includes('application/json')
      ? raw
      : raw
          .split('\n')
          .find((line) => line.startsWith('data: '))!
          .slice(6);
    return (
      JSON.parse(message) as {
        result: { isError?: boolean; structuredContent: Record<string, unknown> };
      }
    ).result;
  }
  it('MCPで既存scopeと接続プロジェクトを守り、局面コメントを追加・一覧取得する', async () => {
    const token = await mcpToken(app, 'alice-project');
    for (const target of [stock, question, pufu]) {
      const result = await call(token, 'add_comment', {
        ...target,
        body: 'MCPの記録',
        request_id: crypto.randomUUID(),
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent.comment).toMatchObject({
        ...target,
        body: 'MCPの記録',
        author_kind: 'agent',
      });
      expect((await call(token, 'list_comments', target)).structuredContent).toMatchObject({
        comments: [{ body: 'MCPの記録' }],
      });
    }
    const foreign = { target_type: 'question', target_id: 'independent' };
    expect((await call(token, 'list_comments', foreign)).structuredContent.status).toBe(404);
    expect(
      (
        await call(token, 'add_comment', {
          ...foreign,
          body: '禁止',
          request_id: crypto.randomUUID(),
        })
      ).structuredContent.status,
    ).toBe(404);
    const readOnly = await mcpToken(app, null, ['stocks:read']);
    expect((await call(readOnly, 'list_comments', stock)).isError).not.toBe(true);
    expect((await call(readOnly, 'list_comments', question)).structuredContent.status).toBe(403);
    expect(
      (
        await call(readOnly, 'add_comment', {
          ...stock,
          body: '禁止',
          request_id: crypto.randomUUID(),
        })
      ).structuredContent.status,
    ).toBe(403);
  });

  it('同じユーザーのWebと別のMCP接続から同じ対象にコメントできる', async () => {
    expect((await add(question, 'Webの記録')).status).toBe(201);
    const first = await mcpToken(app, 'alice-project', ['questions:read', 'questions:write']);
    const second = await mcpToken(app, null, ['questions:read', 'questions:write']);
    for (const [token, body] of [
      [first, 'AI連携Aの記録'],
      [second, 'AI連携Bの記録'],
    ]) {
      expect(
        (await call(token, 'add_comment', { ...question, body, request_id: crypto.randomUUID() }))
          .isError,
      ).not.toBe(true);
      const items = (await call(token, 'list_comments', question)).structuredContent
        .comments as Comment[];
      expect(items.map((item) => item.body)).toContain('Webの記録');
    }
    const data = (await (await list(question)).json()) as { comments: Comment[] };
    expect(data.comments.map((item) => item.body)).toEqual([
      'Webの記録',
      'AI連携Aの記録',
      'AI連携Bの記録',
    ]);
    expect((await call(first, 'list_comments', question)).structuredContent.comments).toEqual(
      data.comments,
    );
  });

  it('局面だけの削除はその局面のコメントだけを消し、退会では残りも消す', async () => {
    for (const target of [stock, question, pufu, { ...pufu, phase: 2 }])
      expect((await add(target)).status).toBe(201);
    await app.env.DB.prepare("DELETE FROM pufu_phases WHERE pufu_id='pufu' AND number=1").run();
    expect(
      (
        await app.env.DB.prepare(
          'SELECT target_type,phase FROM comments ORDER BY target_type,phase',
        ).all()
      ).results,
    ).toEqual([
      { target_type: 'pufu', phase: 2 },
      { target_type: 'question', phase: null },
      { target_type: 'stock', phase: null },
    ]);
    await app.env.DB.prepare("DELETE FROM users WHERE id='alice'").run();
    expect((await app.env.DB.prepare('SELECT * FROM comments').all()).results).toEqual([]);
  });

  it('保存先の移動後は移動先の権限で履歴を引き継ぎ、以前の限定接続から取得・追記できない', async () => {
    const token = await mcpToken(app, 'alice-project');
    expect((await add(pufu, '移動前の記録')).status).toBe(201);
    expect(
      (
        await app.request('/api/v1/stocks/stock', {
          method: 'PATCH',
          body: { note: '', project_id: 'alice-second' },
        })
      ).status,
    ).toBe(200);
    expect(await (await list(pufu)).json()).toMatchObject({ comments: [{ body: '移動前の記録' }] });
    expect((await call(token, 'list_comments', pufu)).structuredContent.status).toBe(404);
    expect(
      (await call(token, 'add_comment', { ...pufu, body: '禁止', request_id: crypto.randomUUID() }))
        .structuredContent.status,
    ).toBe(404);
    const allowed = await mcpToken(app, 'alice-second');
    expect((await call(allowed, 'list_comments', pufu)).structuredContent.comments).toMatchObject([
      { body: '移動前の記録' },
    ]);
  });
});
