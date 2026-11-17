import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import worker from '../server/index';
import { testApp } from './helpers';
import { mcpToken } from './mcp-helpers';
import scoreFixture from './fixtures/pufu-sparse.json';
import oracleFixture from './fixtures/mcp-add-pufu-phase-model.json';

const nat = z.number().int().nonnegative();
const requestSchema = z.strictObject({
  requestId: nat,
  pufuId: z.literal(1),
  revision: nat,
  replacement: nat.nullable(),
  reason: nat.nullable(),
});
const stateSchema = z.strictObject({
  ready: z.boolean(),
  revision: nat,
  currentPhase: nat,
  latestData: nat,
  phases: z.array(z.strictObject({ number: nat, data: nat })),
  comments: z.array(z.strictObject({ phase: nat, reason: nat })),
  relations: z.array(z.union([z.literal(1), z.literal(2)])),
  receipts: z.array(
    requestSchema.omit({ revision: true }).extend({
      requestRevision: nat,
      phase: nat,
      revision: nat,
    }),
  ),
});
const accessSchema = z.strictObject({
  authenticated: z.boolean(),
  writeScope: z.boolean(),
  ownsTarget: z.boolean(),
  projectAllowed: z.boolean(),
});
const fixture = z
  .strictObject({
    version: z.literal(1),
    cases: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-z-]+$/),
          initial: stateSchema,
          steps: z
            .array(
              z.strictObject({
                access: accessSchema,
                request: requestSchema,
                expected: z.strictObject({
                  status: nat,
                  accepted: z.boolean(),
                  created: z.boolean(),
                  phase: nat,
                  revision: nat,
                  state: stateSchema,
                }),
              }),
            )
            .min(1),
        }),
      )
      .min(1),
  })
  .parse(oracleFixture);
const requiredCases = [
  'unauthenticated',
  'scope-denied',
  'owner-denied',
  'project-denied',
  'not-ready',
  'stale-revision',
  'copy',
  'replace-and-reason',
  'replay',
  'late-replay',
  'changed-payload',
  'changed-reason',
  'changed-revision',
  'scope-denied-replay',
  'project-denied-replay',
  'owner-denied-replay',
];
if (JSON.stringify(fixture.cases.map((c) => c.id).sort()) !== JSON.stringify(requiredCases.sort()))
  throw new Error('The Lean conformance scenario inventory changed; review its coverage.');

type ModelState = z.infer<typeof stateSchema>;
type Access = z.infer<typeof accessSchema>;
let app: Awaited<ReturnType<typeof testApp>>;
const tokens = new Map<string, Promise<string>>();
beforeAll(async () => {
  app = await testApp();
});
afterAll(async () => {
  await app?.dispose();
});
const score = (data: number) => {
  const value = structuredClone(scoreFixture);
  value.gainingGoal.text = `model-data-${data}`;
  return value;
};
const reason = (value: number) => `model-reason-${value}`;
const uuid = (scenario: number, id: number) =>
  `00000000-0000-4000-8000-${((scenario + 1) * 100 + id).toString(16).padStart(12, '0')}`;
async function tokenFor(access: Access) {
  if (!access.authenticated) return 'invalid-model-credential';
  const user = access.ownsTarget ? 'alice' : 'bob';
  const project = access.projectAllowed ? null : user === 'alice' ? 'alice-second' : 'bob-project';
  const scopes = access.writeScope ? ['pufus:write'] : ['projects:read'];
  const key = JSON.stringify([user, project, scopes]);
  if (!tokens.has(key)) tokens.set(key, mcpToken(app, project, scopes, user));
  return tokens.get(key)!;
}
async function call(token: string, args: unknown) {
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
        params: {
          name: 'add_pufu_phase',
          arguments: args,
        },
      }),
    }),
    app.env,
    app.ctx,
  );
  if (response.status !== 200)
    return {
      status: response.status,
      accepted: false,
      created: false,
      phase: 0,
      revision: 0,
      data: undefined,
    };
  const raw = await response.text();
  const parsed = JSON.parse(
    response.headers.get('Content-Type')?.includes('application/json')
      ? raw
      : raw
          .split('\n')
          .find((line) => line.startsWith('data:'))!
          .slice(5),
  );
  expect(parsed.result, raw).toBeDefined();
  const result = parsed.result as { isError?: boolean; structuredContent: Record<string, unknown> };
  expect(result.structuredContent, raw).toBeDefined();
  const data = result.structuredContent;
  return result.isError
    ? { status: data.status, accepted: false, created: false, phase: 0, revision: 0, data }
    : {
        status: 200,
        accepted: true,
        created: data.created,
        phase: data.phase,
        revision: data.revision,
        data,
      };
}
async function protectedState() {
  const tables = [
    ['pufu_scores', 'id'],
    ['pufu_phases', 'pufu_id,number'],
    ['pufu_phase_requests', 'user_id,request_id'],
    ['comments', 'id'],
    ['pufu_questions', 'pufu_id,question_id'],
    ['pufu_stocks', 'pufu_id,stock_id'],
    ['articles', 'id'],
    ['stocks', 'id'],
    ['questions', 'id'],
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
  ).map((row) => row.results);
}
function concreteState(state: ModelState) {
  return {
    ...state,
    latestData: score(state.latestData),
    phases: state.phases.map((p) => ({ number: p.number, data: score(p.data) })),
    comments: state.comments.map((c) => ({ phase: c.phase, reason: reason(c.reason) })),
    // Hash preimages are not stored. Observe request identity and the saved receipt result.
    receipts: state.receipts.map((r) => ({
      requestId: r.requestId,
      pufuId: r.pufuId,
      phase: r.phase,
      revision: r.revision,
    })),
  };
}

it.each(fixture.cases)('B04 model: $id', async (scenario) => {
  const index = fixture.cases.findIndex((c) => c.id === scenario.id);
  const questionId = `model-question-${scenario.id}`;
  const articleId = `model-article-${scenario.id}`;
  const stockId = `model-stock-${scenario.id}`;
  await app.env.DB.batch([
    app.env.DB.prepare(
      "INSERT INTO questions(id,project_id,source,text,status) VALUES (?,'alice-project','user','モデルの問い','ready')",
    ).bind(questionId),
    app.env.DB.prepare(
      "INSERT INTO articles(id,user_id,canonical_url,source_url,title,domain,source_type,status) VALUES (?,'alice',?,'','モデルの本文','','text','ready')",
    ).bind(articleId, `text:${scenario.id}`),
    app.env.DB.prepare(
      "INSERT INTO stocks(id,user_id,project_id,article_id) VALUES (?,'alice','alice-project',?)",
    ).bind(stockId, articleId),
  ]);
  const created = await app.request('/api/v1/pufus', {
    method: 'POST',
    body: {
      project_id: 'alice-project',
      score: score(scenario.initial.latestData),
      request_id: uuid(index, 90),
      question_ids: scenario.initial.relations.includes(1) ? [questionId] : [],
      stock_ids: scenario.initial.relations.includes(2) ? [stockId] : [],
    },
  });
  expect(created.status).toBe(201);
  const pufuId = ((await created.json()) as { pufu: { id: string } }).pufu.id;
  expect(scenario.initial.receipts).toEqual([]);
  expect(scenario.initial.comments).toEqual([]);
  await app.env.DB.batch([
    app.env.DB.prepare(
      'UPDATE pufu_scores SET status=?,revision=?,current_phase=?,score_json=? WHERE id=?',
    ).bind(
      scenario.initial.ready ? 'ready' : 'queued',
      scenario.initial.revision,
      scenario.initial.currentPhase,
      JSON.stringify(score(scenario.initial.latestData)),
      pufuId,
    ),
    app.env.DB.prepare('DELETE FROM pufu_phases WHERE pufu_id=?').bind(pufuId),
    ...scenario.initial.phases.map((p) =>
      app.env.DB.prepare(
        "INSERT INTO pufu_phases(pufu_id,number,score_json,created_at,updated_at) VALUES (?,?,?,'2026-11-17T00:00:00Z','2026-11-17T00:00:00Z')",
      ).bind(pufuId, p.number, JSON.stringify(score(p.data))),
    ),
  ]);
  const requestIds = new Map(
    scenario.steps.map((s) => [uuid(index, s.request.requestId), s.request.requestId]),
  );
  const observe = async () => {
    const row = await app.env.DB.prepare(
      'SELECT status,revision,current_phase,score_json FROM pufu_scores WHERE id=?',
    )
      .bind(pufuId)
      .first<{ status: string; revision: number; current_phase: number; score_json: string }>();
    expect(row).not.toBeNull();
    const phases = await app.env.DB.prepare(
      'SELECT number,score_json FROM pufu_phases WHERE pufu_id=? ORDER BY number',
    )
      .bind(pufuId)
      .all<{ number: number; score_json: string }>();
    const comments = await app.env.DB.prepare(
      "SELECT phase,body FROM comments WHERE target_type='pufu' AND target_id=? ORDER BY created_at,id",
    )
      .bind(pufuId)
      .all<{ phase: number; body: string }>();
    const receipts = await app.env.DB.prepare(
      'SELECT request_id,pufu_id,phase,revision FROM pufu_phase_requests WHERE pufu_id=? ORDER BY request_id',
    )
      .bind(pufuId)
      .all<{ request_id: string; pufu_id: string; phase: number; revision: number }>();
    const questions = await app.env.DB.prepare(
      'SELECT question_id FROM pufu_questions WHERE pufu_id=?',
    )
      .bind(pufuId)
      .all<{ question_id: string }>();
    const stocks = await app.env.DB.prepare('SELECT stock_id FROM pufu_stocks WHERE pufu_id=?')
      .bind(pufuId)
      .all<{ stock_id: string }>();
    return {
      ready: row!.status === 'ready',
      revision: row!.revision,
      currentPhase: row!.current_phase,
      latestData: JSON.parse(row!.score_json),
      phases: phases.results.map((p) => ({ number: p.number, data: JSON.parse(p.score_json) })),
      comments: comments.results.map((c) => ({ phase: c.phase, reason: c.body })),
      relations: [
        ...questions.results.map((q) => {
          expect(q.question_id).toBe(questionId);
          return 1;
        }),
        ...stocks.results.map((s) => {
          expect(s.stock_id).toBe(stockId);
          return 2;
        }),
      ],
      receipts: receipts.results.map((r) => {
        expect(r.pufu_id).toBe(pufuId);
        expect(requestIds.has(r.request_id)).toBe(true);
        return {
          requestId: requestIds.get(r.request_id),
          pufuId: 1,
          phase: r.phase,
          revision: r.revision,
        };
      }),
    };
  };
  expect(await observe()).toEqual(concreteState(scenario.initial));
  for (const step of scenario.steps) {
    const token = await tokenFor(step.access);
    const before = await protectedState();
    const actual = await call(token, {
      pufu_id: pufuId,
      request_id: uuid(index, step.request.requestId),
      revision: step.request.revision,
      ...(step.request.replacement === null
        ? {}
        : { projectScore: score(step.request.replacement) }),
      ...(step.request.reason === null ? {} : { reason: reason(step.request.reason) }),
    });
    const { state, ...expected } = step.expected;
    const { data, ...result } = actual;
    expect(result).toEqual(expected);
    if (step.expected.accepted) {
      expect(data?.pufu_id).toBe(pufuId);
      expect(data?.current_phase).toBe(step.expected.phase);
    }
    expect(await observe()).toEqual(concreteState(state));
    if (!step.expected.created) expect(await protectedState()).toEqual(before);
  }
});
