import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../server/index';
import score from './fixtures/pufu-sparse.json';
import { testApp } from './helpers';
import { mcpToken } from './mcp-helpers';
import { b04Paths } from './models/mcp-pufu-writes';

it('B04 MBT: 再送や競合の必須イベントを対応する経路に含める', () => {
  const steps = b04Paths.flatMap(({ steps }) =>
    steps.map(({ state, event }) => [state.value, event.type]),
  );
  expect(steps).toEqual(
    expect.arrayContaining([
      ['firstPhase', 'resendCreate'],
      ['firstPhase', 'changeCreateTitle'],
      ['secondPhase', 'resendFirstAppend'],
      ['secondPhase', 'appendWithOldRevision'],
      ['secondPhase', 'updateWithOldRevision'],
      ['thirdPhase', 'resendFirstAppend'],
      ['thirdPhase', 'changeFirstReason'],
      ['thirdPhase', 'appendWithOldRevision'],
      ['thirdPhase', 'resendCreate'],
      ['withoutWriteScope', 'resendFirstAppend'],
      ['withoutWriteScope', 'resendCreate'],
      ['notReady', 'resendFirstAppend'],
      ['notReady', 'append'],
    ]),
  );
});

describe('B04/B05: MCP境界モデルと実入口・D1の照合', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
  });
  afterEach(async () => app.dispose());

  const fetchWorker = (path: string, init: RequestInit) =>
    worker.fetch(new Request(`${app.env.APP_URL}${path}`, init), app.env, app.ctx);

  const request = (token: string, name: string, args: unknown = {}) =>
    fetchWorker('/mcp', {
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
    });

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
      ['comments', 'phase,id'],
      ['memory_versions', 'user_id,project_id,revision'],
      ['ai_operations', 'id'],
      ['stock_usage', 'user_id'],
    ];
    const results = await app.env.DB.batch<Record<string, unknown>>(
      tables.map(([table, order]) =>
        app.env.DB.prepare(`SELECT * FROM ${table} ORDER BY ${order}`),
      ),
    );
    return Object.fromEntries(tables.map(([table], index) => [table, results[index].results]));
  }

  async function createPufu(project = 'alice-project') {
    const response = await app.request('/api/v1/pufus', {
      method: 'POST',
      body: { project_id: project, score, request_id: crypto.randomUUID() },
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { pufu: { id: string } }).pufu.id;
  }

  const b04Cases = b04Paths.map(({ steps }) => {
    const operations = steps.slice(1); // XStateの初期化イベントを除く。
    return { name: operations.map(({ event }) => event.type).join(' → '), operations };
  });

  it.each(b04Cases)('B04 MBT: $name', async ({ operations }) => {
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
    let pufuId = '';
    const firstRequestId = crypto.randomUUID();
    const secondRequestId = crypto.randomUUID();
    const reasons = ['次の判断を記録', '追加の判断を記録'];
    const revisedScore = { ...score, gainingGoal: { ...score.gainingGoal, text: '局面2の目標' } };
    const firstAppend = () => ({
      pufu_id: pufuId,
      revision: 1,
      request_id: firstRequestId,
      projectScore: revisedScore,
      reason: reasons[0],
    });
    const sendCreate = () => call(token, 'create_pufu', args);
    const handlers = {
      create: sendCreate,
      resendCreate: sendCreate,
      changeCreateTitle: () => call(token, 'create_pufu', { ...args, title: '別の内容' }),
      append: (revision: number) =>
        call(
          token,
          'add_pufu_phase',
          revision === 1
            ? firstAppend()
            : {
                pufu_id: pufuId,
                revision,
                request_id: revision === 2 ? secondRequestId : crypto.randomUUID(),
                reason: reasons[1],
              },
        ),
      resendFirstAppend: () => call(token, 'add_pufu_phase', firstAppend()),
      changeFirstReason: () =>
        call(token, 'add_pufu_phase', { ...firstAppend(), reason: '別の内容' }),
      appendWithOldRevision: () =>
        call(token, 'add_pufu_phase', { ...firstAppend(), request_id: crypto.randomUUID() }),
      updateWithOldRevision: () =>
        call(token, 'update_pufu', { pufu_id: pufuId, revision: 1, projectScore: score }),
      removeWriteScope: async () => {
        const headers = {
          Cookie: 'stock_session=alice-session',
          Origin: app.env.APP_URL,
          'Content-Type': 'application/json',
        };
        const list = await fetchWorker('/api/v1/mcp/connections', { headers });
        expect(list.status).toBe(200);
        const { connections } = (await list.json()) as { connections: { id: string }[] };
        expect(connections).toHaveLength(1);
        const response = await fetchWorker(`/api/v1/mcp/connections/${connections[0].id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ client_name: 'B04 MBT', project_id: args.project_id, scopes: [] }),
        });
        expect(response.status).toBe(200);
      },
      markNotReady: async () => {
        // 元のレシートを残したまま、revisionだけが進んだ未完成状態にする。
        const result = await app.env.DB.prepare(
          "UPDATE pufu_scores SET status='queued',revision=revision+1 WHERE id=?",
        )
          .bind(pufuId)
          .run();
        expect(result.meta.changes).toBe(1);
      },
    };

    let before = await snapshot();
    let previousPhase = 0;
    let previousRevision = 0;
    let createResponse: Record<string, unknown> | undefined;
    let firstAppendResponse: Record<string, unknown> | undefined;
    for (const { event, state } of operations) {
      const { phase, revision, result } = state.context;
      const reply = await handlers[event.type](previousRevision);
      const content = reply?.structuredContent;
      if (result.kind === 'denied') {
        expect(reply, event.type).toMatchObject({
          isError: true,
          structuredContent: { status: result.status },
        });
      } else if (result.kind === 'create') {
        expect(reply?.isError).not.toBe(true);
        if (event.type === 'create') {
          expect(content).toMatchObject({ pufu: { id: expect.any(String) } });
          pufuId = (content?.pufu as { id: string }).id;
          expect(pufuId).not.toBe('');
          createResponse = content;
        }
        expect(content).toMatchObject({
          pufu: {
            id: pufuId,
            revision,
            current_phase: phase,
            title: args.title,
            task: score.gainingGoal.text,
          },
        });
        if (phase === 1) expect(content).toEqual(createResponse);
      } else if (result.kind === 'append') {
        expect(reply?.isError).not.toBe(true);
        expect(content).toMatchObject({
          pufu_id: pufuId,
          phase: result.phase,
          current_phase: result.phase,
          revision: result.revision,
          created: result.created,
        });
        if (event.type === 'resendFirstAppend')
          expect(content).toEqual({ ...firstAppendResponse, created: false });
        else if (result.phase === 2) firstAppendResponse = content;
      }

      const after = await snapshot();
      if (event.type === 'markNotReady') {
        expect(after).toEqual({
          ...before,
          pufu_scores: before.pufu_scores.map((row) => ({ ...row, status: 'queued', revision })),
        });
      } else if (phase === previousPhase) {
        expect(after, event.type).toEqual(before);
      } else {
        expect(after.pufu_scores).toMatchObject([
          { id: pufuId, revision, current_phase: phase, status: 'ready' },
        ]);
        expect(JSON.parse(String(after.pufu_scores[0].score_json))).toEqual(
          phase === 1 ? score : revisedScore,
        );
        expect(after.pufu_phases.slice(0, previousPhase)).toEqual(before.pufu_phases);
        expect(
          after.pufu_phases.map((row) => [row.number, JSON.parse(String(row.score_json))]),
        ).toEqual(
          Array.from({ length: phase }, (_, index) => [index + 1, index ? revisedScore : score]),
        );
        expect(after.pufu_phase_requests).toHaveLength(phase - 1);
        expect(after.comments).toMatchObject(
          reasons.slice(0, phase - 1).map((body, index) => ({
            target_id: pufuId,
            phase: index + 2,
            body,
          })),
        );
        expect(after.pufu_questions).toEqual([
          { pufu_id: pufuId, question_id: args.question_ids[0] },
        ]);
        expect(after.pufu_stocks).toEqual([{ pufu_id: pufuId, stock_id: args.stock_ids[0] }]);
      }
      before = after;
      previousPhase = phase;
      previousRevision = revision;
    }
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
