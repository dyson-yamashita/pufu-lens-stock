import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../server/index';
import score from './fixtures/pufu-sparse.json';
import { testApp } from './helpers';
import { mcpToken } from './mcp-helpers';

// Integration correspondence for formal/mcp-verification; no auth or SQL mocks.
describe('update_pufu: Leanモデルと実装の照合', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  let pufuId: string;
  beforeEach(async () => {
    app = await testApp();
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO questions(id,project_id,source,text,status) VALUES ('verification-question','alice-project','user','検証用の問い','ready')",
      ),
      app.env.DB.prepare(
        "INSERT INTO articles(id,user_id,canonical_url,source_url,title,domain,status) VALUES ('verification-article','alice','https://example.com/poc','https://example.com/poc','検証用記事','example.com','ready')",
      ),
      app.env.DB.prepare(
        "INSERT INTO stocks(id,user_id,project_id,article_id) VALUES ('verification-stock','alice','alice-project','verification-article')",
      ),
    ]);
    const response = await app.request('/api/v1/pufus', {
      method: 'POST',
      body: {
        project_id: 'alice-project',
        score,
        request_id: crypto.randomUUID(),
        question_ids: ['verification-question'],
        stock_ids: ['verification-stock'],
      },
    });
    expect(response.status).toBe(201);
    pufuId = ((await response.json()) as { pufu: { id: string } }).pufu.id;
  });
  afterEach(async () => app.dispose());

  const changedScore = () => {
    const changed = structuredClone(score);
    changed.gainingGoal.text = '形式検証PoCで更新した目標';
    return changed;
  };
  const snapshot = async () =>
    (
      await app.env.DB.batch([
        app.env.DB.prepare('SELECT * FROM pufu_scores ORDER BY id'),
        app.env.DB.prepare('SELECT * FROM pufu_phases ORDER BY pufu_id,number'),
        app.env.DB.prepare('SELECT * FROM pufu_questions ORDER BY pufu_id,question_id'),
        app.env.DB.prepare('SELECT * FROM pufu_stocks ORDER BY pufu_id,stock_id'),
      ])
    ).map((result) => result.results);

  async function update(token?: string, args: Record<string, unknown> = {}) {
    return worker.fetch(
      new Request(`${app.env.APP_URL}/mcp`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          Host: new URL(app.env.APP_URL).host,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'update_pufu',
            arguments: { pufu_id: pufuId, revision: 1, projectScore: changedScore(), ...args },
          },
        }),
      }),
      app.env,
      app.ctx,
    );
  }

  async function result(response: Response) {
    expect(response.status).toBe(200);
    const text = await response.text();
    const message = JSON.parse(
      response.headers.get('Content-Type')?.includes('application/json')
        ? text
        : text
            .split('\n')
            .find((line) => line.startsWith('data: '))!
            .slice(6),
    ) as {
      result: { isError?: boolean; structuredContent: Record<string, unknown> };
    };
    expect(message.result).toBeDefined();
    return message.result;
  }

  it.each([undefined, 'invalid-token'])('P1/P3: 未認証(%s)ならDBを変更しない', async (token) => {
    const before = await snapshot();
    expect((await update(token)).status).toBe(401);
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    {
      label: '書込スコープなし',
      projects: null,
      scopes: ['questions:read'],
      user: 'alice',
      status: 403,
    },
    {
      label: '許可対象外のプロジェクト',
      projects: ['alice-second'],
      scopes: ['pufus:write'],
      user: 'alice',
      status: 404,
    },
    {
      label: '別ユーザー（全プロジェクト許可）',
      projects: null,
      scopes: ['pufus:write'],
      user: 'bob',
      status: 404,
    },
    {
      label: '複数許可でも対象外',
      projects: ['alice-second', 'alice-third'],
      scopes: ['pufus:write'],
      user: 'alice',
      status: 404,
    },
  ])('P2/P3: $label ならDBを変更しない', async ({ projects, scopes, user, status }) => {
    await app.env.DB.prepare(
      "INSERT INTO projects(id,user_id,name) VALUES ('alice-third','alice','Third project')",
    ).run();
    const token = await mcpToken(app, projects, scopes, user);
    const before = await snapshot();
    expect(await result(await update(token))).toMatchObject({
      isError: true,
      structuredContent: { status },
    });
    expect(await snapshot()).toEqual(before);
  });

  it.each(['scopes', 'projects', 'revoked'] as const)(
    'P1–P3: 発行後に%sを制限した既存トークンでもDBを変更しない',
    async (restriction) => {
      const token = await mcpToken(app, null, ['pufus:write']);
      // Persisted server settings override the original token's grants.
      const grant = await app.env.OAUTH_PROVIDER!.unwrapToken(token);
      expect(grant).toBeTruthy();
      const saved = await app.env.DB.prepare(
        'INSERT INTO mcp_connection_settings(user_id,grant_id,client_name,scopes,project_ids,revoked) VALUES (?,?,?,?,?,?)',
      )
        .bind(
          'alice',
          grant!.grantId,
          'PoC test connection',
          restriction === 'scopes' ? '[]' : '["pufus:write"]',
          restriction === 'projects' ? '[]' : null,
          Number(restriction === 'revoked'),
        )
        .run();
      expect(saved.meta.changes).toBe(1);
      const before = await snapshot();
      const response = await update(token);
      if (restriction === 'scopes')
        expect(await result(response)).toMatchObject({
          isError: true,
          structuredContent: { status: 403 },
        });
      else expect(response.status).toBe(restriction === 'revoked' ? 401 : 403);
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each([
    { projects: null },
    { projects: ['alice-project'] },
    { projects: ['alice-second', 'alice-project'] },
  ])(
    'P4: 許可プロジェクト$projectsでは最新局面のデータとrevisionを更新する',
    async ({ projects }) => {
      const token = await mcpToken(app, projects, ['pufus:write']);
      const before = await snapshot();
      expect(await result(await update(token))).toMatchObject({
        structuredContent: { revision: 2, current_phase: 1 },
      });
      const state = await snapshot();
      expect(state[0][0]).toMatchObject({
        revision: 2,
        current_phase: 1,
        score_json: JSON.stringify(changedScore()),
      });
      expect(state[1]).toHaveLength(1);
      expect(state[1][0]).toMatchObject({ number: 1, score_json: JSON.stringify(changedScore()) });
      expect(state[2]).toHaveLength(1);
      expect(state[3]).toHaveLength(1);
      expect(state.slice(2)).toEqual(before.slice(2));
      // Same input is not idempotent: the old revision now conflicts.
      expect(await result(await update(token))).toMatchObject({
        isError: true,
        structuredContent: { status: 409 },
      });
      expect(await snapshot()).toEqual(state);
    },
  );

  it('P3: 旧データの局面が欠けていても権限拒否では初期化を含めて書き込まない', async () => {
    await app.env.DB.prepare('DELETE FROM pufu_phases WHERE pufu_id=?').bind(pufuId).run();
    const token = await mcpToken(app, 'alice-second', ['pufus:write']);
    const before = await snapshot();
    expect(await result(await update(token))).toMatchObject({
      isError: true,
      structuredContent: { status: 404 },
    });
    expect(await snapshot()).toEqual(before);
  });

  it('P4: 過去局面を編集しても最新局面のJSONと局面数を維持しrevisionだけ1増やす', async () => {
    const second = structuredClone(score);
    second.gainingGoal.text = '最新局面の目標';
    const append = await app.request(`/api/v1/pufus/${pufuId}/phases`, {
      method: 'POST',
      body: { revision: 1, phase: 1, score: second },
    });
    expect(append.status).toBe(201);
    const token = await mcpToken(app, 'alice-project', ['pufus:write']);
    expect(await result(await update(token, { revision: 2, phase: 1 }))).toMatchObject({
      structuredContent: { revision: 3, current_phase: 2 },
    });
    const state = await snapshot();
    expect(state[0][0]).toMatchObject({
      revision: 3,
      current_phase: 2,
      score_json: JSON.stringify(second),
    });
    expect(state[1]).toHaveLength(2);
    expect(state[1][0]).toMatchObject({ number: 1, score_json: JSON.stringify(changedScore()) });
    expect(state[1][1]).toMatchObject({ number: 2, score_json: JSON.stringify(second) });
  });

  it('モデルの境界: 旧データの局面初期化はrevision競合の拒否でも実行される', async () => {
    await app.env.DB.prepare('DELETE FROM pufu_phases WHERE pufu_id=?').bind(pufuId).run();
    const token = await mcpToken(app, 'alice-project', ['pufus:write']);
    const before = await snapshot();
    expect(before[1]).toEqual([]);
    expect(await result(await update(token, { revision: 999 }))).toMatchObject({
      isError: true,
      structuredContent: { status: 409 },
    });
    const after = await snapshot();
    expect(after[0]).toEqual(before[0]);
    expect(after[1]).toHaveLength(1);
    expect(after[1][0]).toMatchObject({ number: 1, score_json: JSON.stringify(score) });
    expect(after.slice(2)).toEqual(before.slice(2));
  });
});
