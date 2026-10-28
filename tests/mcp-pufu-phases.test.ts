import { afterEach, beforeEach, expect, it } from 'vitest';
import { testApp } from './helpers';
import { mcpToken } from './mcp-helpers';
import worker from '../server/index';
import type { Pufu, PufuScore } from '../shared/pufu';
import fixture from './fixtures/pufu-sparse.json';

let app: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  app = await testApp();
});
afterEach(async () => app.dispose());
async function rpc(token: string, method: string, params: unknown = {}) {
  const response = await worker.fetch(
    new Request(`${app.env.APP_URL}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Host: new URL(app.env.APP_URL).host,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
    app.env,
    app.ctx,
  );
  expect(response.status).toBe(200);
  const text = await response.text();
  return JSON.parse(
    response.headers.get('Content-Type')?.includes('application/json')
      ? text
      : text
          .split('\n')
          .find((line) => line.startsWith('data: '))!
          .slice(6),
  ).result;
}
const call = (token: string, args: unknown) =>
  rpc(token, 'tools/call', {
    name: 'add_pufu_phase',
    arguments: args,
  });
async function create(project = 'alice-project', user = 'alice') {
  const response = await app.request('/api/v1/pufus', {
    method: 'POST',
    user,
    body: { project_id: project, score: fixture, request_id: crypto.randomUUID() },
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { pufu: { id: string } }).pufu.id;
}
async function get(id: string) {
  return ((await (await app.request(`/api/v1/pufus/${id}`)).json()) as { pufu: Pufu }).pufu;
}
async function snapshot() {
  return (
    await app.env.DB.batch([
      app.env.DB.prepare('SELECT * FROM pufu_scores ORDER BY id'),
      app.env.DB.prepare('SELECT * FROM pufu_phases ORDER BY pufu_id,number'),
      app.env.DB.prepare('SELECT * FROM comments ORDER BY id'),
    ])
  ).map((row) => row.results);
}

it('MCPの局面追加は前の局面を保持し、変更・複製・最初のコメントをWebでも取得できる', async () => {
  const token = await mcpToken(app, 'alice-project', ['questions:read', 'pufus:write']);
  const id = await create();
  const oldComment = await app.request('/api/v1/comments', {
    method: 'POST',
    body: {
      target_type: 'pufu',
      target_id: id,
      phase: 1,
      body: '第1局面の記録',
      request_id: crypto.randomUUID(),
    },
  });
  expect(oldComment.status).toBe(201);
  const previousComments = await (
    await app.request(`/api/v1/comments?target_type=pufu&target_id=${id}&phase=1`)
  ).json();
  const before = await get(id);
  const changed: PufuScore = structuredClone(fixture) as PufuScore;
  changed.gainingGoal.text = '結果を踏まえて次を試す';
  changed.purposes[0].measures[0].progress = 70;
  changed.purposes[0].measures[0].id = 'saved-measure';
  changed.purposes[0].measures[0].comment = { color: 'green', text: '試した結果を記録' };
  changed.purposes[0].measures.push({
    ...structuredClone(changed.purposes[0].measures[0]),
    uuid: 'next-measure',
    text: '振り返る',
    color: 'yellow',
    progress: undefined,
  });
  const added = await call(token, {
    pufu_id: id,
    revision: 1,
    request_id: crypto.randomUUID(),
    projectScore: changed,
    reason: '想定外の結果が得られた',
  });
  expect(added?.isError).not.toBe(true);
  expect(added?.structuredContent).toMatchObject({
    pufu_id: id,
    phase: 2,
    current_phase: 2,
    revision: 2,
    created: true,
    comment_id: expect.any(String),
  });
  const second = await get(id);
  expect(second.phases[0]).toEqual(before.phases[0]);
  expect(second.phases[1].score).toEqual(JSON.parse(JSON.stringify(changed)));
  expect(second.score).toEqual(second.phases[1].score);
  const comments = await app.request(`/api/v1/comments?target_type=pufu&target_id=${id}&phase=2`);
  expect(await comments.json()).toMatchObject({
    comments: [
      {
        id: added.structuredContent.comment_id,
        body: '想定外の結果が得られた',
        phase: 2,
        author_kind: 'agent',
        author_id: 'alice',
      },
    ],
  });
  const third = await call(token, { pufu_id: id, revision: 2, request_id: crypto.randomUUID() });
  expect(third?.structuredContent).toMatchObject({ phase: 3, revision: 3, created: true });
  expect(third.structuredContent).not.toHaveProperty('comment_id');
  const saved = await get(id);
  expect(saved.phases.slice(0, 2)).toEqual(second.phases);
  expect(saved.phases[2].score).toEqual(second.score);
  expect(
    await (await app.request(`/api/v1/comments?target_type=pufu&target_id=${id}&phase=1`)).json(),
  ).toEqual(previousComments);
  const latest = await rpc(token, 'tools/call', { name: 'get_pufu', arguments: { pufu_id: id } });
  expect(latest.structuredContent).toMatchObject({
    phase: 3,
    revision: 3,
    projectScore: saved.score,
  });
});

it('同一リクエストの同時再送と後日の再送で局面・コメントが重複せず元の結果を返す', async () => {
  const token = await mcpToken(app, null, ['pufus:write']);
  const id = await create();
  const args = { pufu_id: id, revision: 1, request_id: crypto.randomUUID(), reason: '次へ' };
  const results = await Promise.all([call(token, args), call(token, args)]);
  expect(results.map((result) => result?.structuredContent?.created).sort()).toEqual([false, true]);
  expect(results[0].structuredContent).toEqual({
    ...results[1].structuredContent,
    created: results[0].structuredContent.created,
  });
  await call(token, { pufu_id: id, revision: 2, request_id: crypto.randomUUID() });
  const before = await snapshot();
  expect((await call(token, args)).structuredContent).toEqual({
    ...results[0].structuredContent,
    created: false,
  });
  expect(await snapshot()).toEqual(before);
  expect((await get(id)).phases).toHaveLength(3);
  const rows = await app.env.DB.prepare('SELECT * FROM comments').all();
  expect(rows.results).toHaveLength(1);
  for (const changed of [
    { ...args, reason: '別の理由' },
    { ...args, revision: 3 },
    { ...args, projectScore: fixture },
    { ...args, pufu_id: await create() },
  ]) {
    expect(await call(token, changed)).toMatchObject({
      isError: true,
      structuredContent: { status: 409 },
    });
  }
});

it('別リクエストの同時追加は一方だけ成功し古いrevisionでは何も保存しない', async () => {
  const token = await mcpToken(app, null, ['pufus:write']);
  const id = await create();
  const results = await Promise.all(
    ['一つ目', '二つ目'].map((reason) =>
      call(token, {
        pufu_id: id,
        revision: 1,
        request_id: crypto.randomUUID(),
        reason,
      }),
    ),
  );
  expect(results.filter((result) => result?.structuredContent?.created)).toHaveLength(1);
  expect(results.find((result) => result?.isError)?.structuredContent.status).toBe(409);
  const saved = await get(id);
  expect(saved.phases).toHaveLength(2);
  expect(saved.revision).toBe(2);
  expect((await app.env.DB.prepare('SELECT * FROM comments').all()).results).toHaveLength(1);
  const before = await snapshot();
  expect(
    await call(token, { pufu_id: id, revision: 1, request_id: crypto.randomUUID() }),
  ).toMatchObject({ isError: true, structuredContent: { status: 409 } });
  expect(await snapshot()).toEqual(before);
});

it('書込権限・所有者・許可プロジェクトを検証し、成功済みの再送でも範囲外なら拒否する', async () => {
  const id = await create();
  const token = await mcpToken(app, 'alice-project', ['pufus:write']);
  const readToken = await mcpToken(app, null, ['questions:read', 'questions:write']);
  const args = { pufu_id: id, revision: 1, request_id: crypto.randomUUID() };
  const before = await snapshot();
  expect(await call(readToken, args)).toMatchObject({
    isError: true,
    structuredContent: { status: 403 },
  });
  for (const pufu_id of [
    'missing',
    await create('bob-project', 'bob'),
    await create('alice-second'),
  ]) {
    expect(await call(token, { ...args, pufu_id })).toMatchObject({
      isError: true,
      structuredContent: { status: 404 },
    });
  }
  expect((await get(id)).phases).toHaveLength(1);
  expect(before[2]).toEqual([]);
  const accepted = await call(token, args);
  expect(accepted?.structuredContent).toMatchObject({ phase: 2 });
  // 同一所有者内のプロジェクト移動後も、旧範囲の接続では再送結果を取得できない。
  await app.env.DB.prepare("UPDATE pufu_scores SET project_id='alice-second' WHERE id=?")
    .bind(id)
    .run();
  expect(await call(token, args)).toMatchObject({
    isError: true,
    structuredContent: { status: 404 },
  });
  const global = await mcpToken(app, null, ['pufus:write']);
  expect((await call(global, args)).structuredContent).toMatchObject({ phase: 2, created: false });
});

it('不正入力・未完成・壊れた保存データを拒否し、局面やコメントを変更しない', async () => {
  const token = await mcpToken(app, null, ['pufus:write']);
  const id = await create();
  const args = { pufu_id: id, revision: 1, request_id: crypto.randomUUID() };
  const before = await snapshot();
  for (const invalid of [
    { ...args, revision: 0 },
    { ...args, revision: undefined },
    { ...args, request_id: 'bad' },
    { ...args, projectScore: {} },
    { ...args, reason: 'a'.repeat(2001) },
    { ...args, reason: '' },
    { ...args, phase: 1 },
  ]) {
    expect((await call(token, invalid))?.isError).toBe(true);
  }
  expect(await snapshot()).toEqual(before);
  await app.env.DB.prepare("UPDATE pufu_scores SET status='generating' WHERE id=?").bind(id).run();
  expect(await call(token, args)).toMatchObject({
    isError: true,
    structuredContent: { status: 409 },
  });
  await app.env.DB.prepare("UPDATE pufu_scores SET status='ready',score_json='broken' WHERE id=?")
    .bind(id)
    .run();
  expect(await call(token, args)).toMatchObject({
    isError: true,
    structuredContent: { status: 500 },
  });
  expect((await app.env.DB.prepare('SELECT * FROM pufu_phases').all()).results).toEqual(before[1]);
  expect((await app.env.DB.prepare('SELECT * FROM comments').all()).results).toEqual([]);
});

it('旧データの欠けた第1局面は元の内容と日時で補い、原局面を新しい内容で上書きしない', async () => {
  const token = await mcpToken(app, null, ['pufus:write']);
  const id = await create();
  const original = await get(id);
  await app.env.DB.prepare('DELETE FROM pufu_phases WHERE pufu_id=?').bind(id).run();
  const changed = structuredClone(fixture);
  changed.gainingGoal.text = '次の局面';
  expect(
    (
      await call(token, {
        pufu_id: id,
        revision: 1,
        request_id: crypto.randomUUID(),
        projectScore: changed,
      })
    ).structuredContent,
  ).toMatchObject({ phase: 2 });
  expect((await get(id)).phases).toEqual([
    original.phases[0],
    expect.objectContaining({ number: 2, score: changed }),
  ]);
});

it('書込だけの接続で内容を漏らさず、tools/listに必要なOAuth許可を公開する', async () => {
  const token = await mcpToken(app, null, ['pufus:write']);
  const id = await create();
  const response = await call(token, { pufu_id: id, revision: 1, request_id: crypto.randomUUID() });
  expect(response?.structuredContent).toMatchObject({ phase: 2, revision: 2 });
  expect(response.structuredContent).not.toHaveProperty('projectScore');
  expect(JSON.stringify(response)).not.toContain(fixture.gainingGoal.text);
  const listed = await rpc(token, 'tools/list');
  expect(listed.tools).toContainEqual(
    expect.objectContaining({
      name: 'add_pufu_phase',
      securitySchemes: [{ type: 'oauth2', scopes: ['pufus:write'] }],
      annotations: expect.objectContaining({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      }),
    }),
  );
});

it('大きな局面も保存でき、256KiB超過は入力時・複製時とも何も作らず拒否する', async () => {
  const token = await mcpToken(app, null, ['pufus:write']);
  const id = await create();
  const large: PufuScore = structuredClone(fixture) as PufuScore;
  const node = (uuid: string) => ({
    uuid,
    text: 'a'.repeat(1200),
    comment: { color: 'blue' as const, text: '' },
  });
  large.purposes = Array.from({ length: 12 }, (_, i) => ({
    ...node(`p${i}`),
    measures: Array.from({ length: 12 }, (_, j) => ({
      ...node(`m${i}-${j}`),
      color: 'white' as const,
    })),
  }));
  const args = { pufu_id: id, revision: 1, request_id: crypto.randomUUID(), projectScore: large };
  expect(Buffer.byteLength(JSON.stringify(args))).toBeGreaterThan(16384);
  expect((await call(token, args)).structuredContent).toMatchObject({ phase: 2 });
  const oversized = structuredClone(large);
  for (const purpose of oversized.purposes) {
    purpose.comment.text = 'b'.repeat(450);
    for (const measure of purpose.measures) measure.comment.text = 'b'.repeat(450);
  }
  const bigArgs = {
    ...args,
    revision: 2,
    request_id: crypto.randomUUID(),
    projectScore: oversized,
  };
  expect(Buffer.byteLength(JSON.stringify(bigArgs))).toBeGreaterThan(262144);
  expect(Buffer.byteLength(JSON.stringify(bigArgs))).toBeLessThan(278000);
  const before = await snapshot();
  expect(await call(token, bigArgs)).toMatchObject({
    isError: true,
    structuredContent: { status: 413 },
  });
  expect(await snapshot()).toEqual(before);
  await app.env.DB.prepare('UPDATE pufu_phases SET score_json=? WHERE pufu_id=? AND number=2')
    .bind(JSON.stringify(oversized), id)
    .run();
  expect(
    await call(token, { pufu_id: id, revision: 2, request_id: crypto.randomUUID() }),
  ).toMatchObject({ isError: true, structuredContent: { status: 413 } });
  expect((await get(id)).phases).toHaveLength(2);
});

it('コメント保存の失敗時は局面と再送記録もロールバックし、同じIDで再試行できる', async () => {
  const token = await mcpToken(app, null, ['pufus:write']);
  const id = await create();
  const args = { pufu_id: id, revision: 1, request_id: crypto.randomUUID(), reason: '振り返り' };
  const before = await snapshot();
  await app.env.DB.exec(
    "CREATE TRIGGER fail_phase_comment BEFORE INSERT ON comments BEGIN SELECT RAISE(ABORT,'test_comment_failure'); END;",
  );
  expect(await call(token, args)).toMatchObject({
    isError: true,
    structuredContent: { status: 500 },
  });
  expect(await snapshot()).toEqual(before);
  expect((await app.env.DB.prepare('SELECT * FROM pufu_phase_requests').all()).results).toEqual([]);
  await app.env.DB.exec('DROP TRIGGER fail_phase_comment');
  expect((await call(token, args)).structuredContent).toMatchObject({ phase: 2, created: true });
  await app.env.DB.prepare('DELETE FROM pufu_scores WHERE id=?').bind(id).run();
  expect(await call(token, args)).toMatchObject({
    isError: true,
    structuredContent: { status: 404 },
  });
  expect((await app.env.DB.prepare('SELECT * FROM pufu_phase_requests').all()).results).toEqual([]);
  expect((await app.env.DB.prepare('SELECT * FROM comments').all()).results).toEqual([]);
});
