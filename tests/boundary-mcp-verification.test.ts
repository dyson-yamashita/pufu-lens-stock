import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../server/index';
import score from './fixtures/pufu-sparse.json';
import { testApp } from './helpers';
import { mcpToken } from './mcp-helpers';

describe('B04/B05: MCP境界モデルと実入口・D1の照合', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
  });
  afterEach(async () => app.dispose());

  const request = (token: string, name: string, args: unknown = {}) =>
    worker.fetch(
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

  async function call(token: string, name: string, args: unknown = {}) {
    const response = await request(token, name, args);
    const raw = await response.text();
    expect(response.status, raw).toBe(200);
    return JSON.parse(
      response.headers.get('Content-Type')?.includes('application/json')
        ? raw
        : raw
            .split('\n')
            .find((line) => line.startsWith('data: '))!
            .slice(6),
    ).result as {
      isError?: boolean;
      structuredContent: Record<string, unknown>;
      _meta?: Record<string, unknown>;
    };
  }

  // OAuthの利用記録は含めず、業務データ・再送レシート・関連・履歴・利用枠を保護する。
  async function snapshot() {
    const tables = [
      ['articles', 'id'],
      ['stocks', 'id'],
      ['pufu_scores', 'id'],
      ['pufu_phases', 'pufu_id,number'],
      ['pufu_phase_requests', 'user_id,request_id'],
      ['pufu_questions', 'pufu_id,question_id'],
      ['pufu_stocks', 'pufu_id,stock_id'],
      ['questions', 'id'],
      ['question_stocks', 'question_id,stock_id'],
      ['comments', 'id'],
      ['memory_versions', 'user_id,project_id,revision'],
      ['ai_operations', 'id'],
      ['stock_usage', 'user_id'],
    ];
    return (
      await app.env.DB.batch(
        tables.map(([table, order]) =>
          app.env.DB.prepare(`SELECT * FROM ${table} ORDER BY ${order}`),
        ),
      )
    ).map((result) => result.results);
  }

  async function createPufu(project = 'alice-project') {
    const response = await app.request('/api/v1/pufus', {
      method: 'POST',
      body: { project_id: project, score, request_id: crypto.randomUUID() },
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { pufu: { id: string } }).pufu.id;
  }

  it('B04: 再送・競合・古いrevisionでレシートや関連・履歴・利用枠も増やさない', async () => {
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO questions(id,project_id,source,text,status) VALUES ('boundary-question','alice-project','user','保存する問い','ready')",
      ),
      app.env.DB.prepare(
        "INSERT INTO articles(id,user_id,canonical_url,source_url,title,domain,status) VALUES ('boundary-article','alice','https://example.com/boundary','https://example.com/boundary','保存する記事','example.com','ready')",
      ),
      app.env.DB.prepare(
        "INSERT INTO stocks(id,user_id,project_id,article_id) VALUES ('boundary-stock','alice','alice-project','boundary-article')",
      ),
    ]);
    const token = await mcpToken(app, 'alice-project', ['pufus:write']);
    const args = {
      project_id: 'alice-project',
      question_ids: ['boundary-question'],
      stock_ids: ['boundary-stock'],
      title: '作成要求のタイトル',
      projectScore: score,
      request_id: crypto.randomUUID(),
    };
    const first = await call(token, 'create_pufu', args);
    expect(first.isError).not.toBe(true);
    const pufu = first.structuredContent.pufu as { id: string; revision: number };
    expect(pufu.revision).toBe(1);
    const afterCreate = await snapshot();
    expect((await call(token, 'create_pufu', args)).structuredContent).toEqual(
      first.structuredContent,
    );
    expect(await snapshot()).toEqual(afterCreate);
    expect(await call(token, 'create_pufu', { ...args, title: '別の内容' })).toMatchObject({
      isError: true,
      structuredContent: { status: 409 },
    });
    expect(await snapshot()).toEqual(afterCreate);

    const phase = {
      pufu_id: pufu.id,
      revision: 1,
      request_id: crypto.randomUUID(),
      reason: '次の判断を記録',
    };
    const added = await call(token, 'add_pufu_phase', phase);
    expect(added.structuredContent).toMatchObject({ phase: 2, revision: 2, created: true });
    expect(
      (
        await call(token, 'add_pufu_phase', {
          ...phase,
          revision: 2,
          request_id: crypto.randomUUID(),
        })
      ).structuredContent,
    ).toMatchObject({ phase: 3, revision: 3, created: true });
    const later = await snapshot();
    expect((await call(token, 'add_pufu_phase', phase)).structuredContent).toEqual({
      ...added.structuredContent,
      created: false,
    });
    for (const changed of [
      { ...phase, reason: '別の内容' },
      { ...phase, request_id: crypto.randomUUID() },
    ]) {
      expect(await call(token, 'add_pufu_phase', changed)).toMatchObject({
        isError: true,
        structuredContent: { status: 409 },
      });
      expect(await snapshot()).toEqual(later);
    }
    // createは不変レシートではなく現在行のrevisionを返す。元のID・入力内容は維持する。
    expect((await call(token, 'create_pufu', args)).structuredContent).toMatchObject({
      pufu: { id: pufu.id, revision: 3, current_phase: 3, title: args.title },
    });
    expect(await snapshot()).toEqual(later);
  });

  it('B04: 関係ゼロでもlegacy省略と明示空配列の形を変えた再送は409でDBを維持する', async () => {
    const token = await mcpToken(app, 'alice-project', ['pufus:write']);
    for (const explicit of [false, true]) {
      const args = {
        project_id: 'alice-project',
        projectScore: score,
        request_id: crypto.randomUUID(),
      };
      const emptyRelations = { question_ids: [], stock_ids: [] };
      const original = { ...args, ...(explicit ? emptyRelations : {}) };
      const changed = { ...args, ...(explicit ? {} : emptyRelations) };
      const first = await call(token, 'create_pufu', original);
      expect(first.isError).not.toBe(true);
      const before = await snapshot();
      expect((await call(token, 'create_pufu', original)).structuredContent).toEqual(
        first.structuredContent,
      );
      expect(await call(token, 'create_pufu', changed)).toMatchObject({
        isError: true,
        structuredContent: { status: 409 },
      });
      expect(await snapshot()).toEqual(before);
    }
  });

  it('B04: scope・所有者・プロジェクトの拒否では成功済み再送でも保護状態を変更しない', async () => {
    const args = {
      project_id: 'alice-project',
      projectScore: score,
      request_id: crypto.randomUUID(),
    };
    const token = await mcpToken(app, 'alice-project', ['pufus:write']);
    const created = await call(token, 'create_pufu', args);
    const pufu = created.structuredContent.pufu as { id: string };
    const phase = { pufu_id: pufu.id, revision: 1, request_id: crypto.randomUUID() };
    expect((await call(token, 'add_pufu_phase', phase)).isError).not.toBe(true);
    for (const [projects, scopes, user, status] of [
      ['alice-project', ['questions:write'], 'alice', 403],
      ['alice-second', ['pufus:write'], 'alice', 404],
      ['bob-project', ['pufus:write'], 'bob', 404],
    ] as const) {
      const denied = await mcpToken(app, projects, [...scopes], user);
      const before = await snapshot();
      expect(await call(denied, 'create_pufu', args)).toMatchObject({
        isError: true,
        structuredContent: { status },
      });
      expect(await call(denied, 'add_pufu_phase', phase)).toMatchObject({
        isError: true,
        structuredContent: { status },
      });
      expect(await snapshot()).toEqual(before);
    }
  });

  it('B05: プ譜一覧は許可集合で絞った後に総数とページを求め、選択された非表示先を含める', async () => {
    await app.env.DB.prepare(
      "UPDATE projects SET show_in_all_lists=0 WHERE id='alice-project'",
    ).run();
    const rows = [
      ...Array.from({ length: 25 }, (_, index) => [
        `selected-${String(index).padStart(2, '0')}`,
        'alice',
        'alice-project',
      ]),
      ['outside', 'alice', 'alice-second'],
      ['foreign', 'bob', 'bob-project'],
    ];
    await app.env.DB.batch(
      rows.map(([id, user, project]) =>
        app.env.DB.prepare(
          "INSERT INTO pufu_scores(id,user_id,project_id,task,input_json,score_json,editor_version,status) VALUES (?,?,?,'一覧テスト','{}',?,'test','ready')",
        ).bind(id, user, project, JSON.stringify(score)),
      ),
    );
    const global = await mcpToken(app, null, ['questions:read']);
    const selected = await mcpToken(app, 'alice-project', ['projects:read', 'questions:read']);
    const before = await snapshot();
    expect((await call(global, 'list_pufus')).structuredContent).toMatchObject({
      total: 1,
      pufus: [{ id: 'outside' }],
    });
    const seen = new Set<string>();
    for (const page of [1, 2, 3]) {
      const result = (await call(selected, 'list_pufus', { page })).structuredContent;
      const pufus = result.pufus as { id: string; project_id: string }[];
      expect(result).toMatchObject({ total: 25, page, pageSize: 24 });
      expect(pufus).toHaveLength(page === 1 ? 24 : page === 2 ? 1 : 0);
      for (const row of pufus) {
        expect(row.project_id).toBe('alice-project');
        seen.add(row.id);
      }
    }
    expect(seen.size).toBe(25);
    expect((await call(selected, 'list_projects')).structuredContent).toMatchObject({
      projects: [{ id: 'alice-project', show_in_all_lists: false }],
    });
    expect(
      (await call(global, 'list_pufus', { project_id: 'alice-project' })).structuredContent.total,
    ).toBe(25);
    expect(await snapshot()).toEqual(before);
  });

  it('B05: プ譜のコメントはquestions権限を使い、pufus書込権限を読取・コメント権限へ昇格しない', async () => {
    const id = await createPufu();
    const target = { target_type: 'pufu', target_id: id, phase: 1 };
    const pufuWriter = await mcpToken(app, 'alice-project', ['pufus:write']);
    const questionWriter = await mcpToken(app, 'alice-project', ['questions:write']);
    const before = await snapshot();
    const denied = await call(pufuWriter, 'add_comment', {
      ...target,
      body: '書き込めない記録',
      request_id: crypto.randomUUID(),
    });
    expect(denied).toMatchObject({ isError: true, structuredContent: { status: 403 } });
    expect(denied._meta?.['mcp/www_authenticate']).toEqual([
      expect.stringContaining('scope="questions:write"'),
    ]);
    expect(await snapshot()).toEqual(before);
    const added = await call(questionWriter, 'add_comment', {
      ...target,
      body: '許可された記録',
      request_id: crypto.randomUUID(),
    });
    expect(added.structuredContent).toMatchObject({
      comment: { ...target, body: '許可された記録', author_kind: 'agent' },
    });
    const afterWrite = await snapshot();
    for (const token of [pufuWriter, questionWriter])
      expect(await call(token, 'list_comments', target)).toMatchObject({
        isError: true,
        structuredContent: { status: 403 },
      });
    expect(await snapshot()).toEqual(afterWrite);
  });

  it('B05: 最後の許可先削除後は他の本人プロジェクトがあっても一覧を全体公開へ拡張しない', async () => {
    await createPufu('alice-second');
    const token = await mcpToken(app, 'alice-project', [
      'projects:read',
      'stocks:read',
      'questions:read',
      'memories:read',
    ]);
    await app.env.DB.prepare("DELETE FROM projects WHERE id='alice-project'").run();
    const before = await snapshot();
    for (const [tool, args] of [
      ['list_projects', {}],
      ['list_stocks', {}],
      ['list_questions', {}],
      ['list_pufus', {}],
      ['get_project_memory', { project_id: 'alice-second' }],
    ] as const) {
      const response = await request(token, tool, args);
      expect(response.status, tool).toBe(403);
      expect(await response.text()).not.toContain('alice-second');
    }
    expect(await snapshot()).toEqual(before);
  });
});
