import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  saveMemoryWithHistory,
  type MemorySaveInput,
} from '../server/features/memory/memory-history';
import { queueFootprintJobs } from '../server/features/memory/footprint-repository';
import { ArticleWorkflow } from '../server/infrastructure/jobs/workflows';
import type { FootprintAnalysis } from '../shared/footprints';
import { mockEvent, mockStep, testApp } from './helpers';

const project = 'alice-project';
const endpoint = `/api/v1/projects/${project}/footprints`;
const input = (revision: number): MemorySaveInput => ({
  userId: 'alice',
  projectId: project,
  revision,
  text: `Memory ${revision}`,
  dataJson: JSON.stringify({ interests: [`Interest ${revision}`], knowledge: [], questions: [] }),
  articleCount: 0,
  model: 'memory-test',
  contextHash: '',
  language: 'en',
});
let app: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  app = await testApp();
});
afterEach(async () => {
  await app.dispose();
});

async function save(revision: number) {
  await app.env.DB.prepare('UPDATE projects SET memory_revision=? WHERE id=?')
    .bind(revision, project)
    .run();
  await saveMemoryWithHistory(app.env, input(revision), []);
}

async function settings(footprint_interval: number, footprints_enabled: boolean) {
  const res = await app.request(`/api/v1/projects/${project}`, {
    method: 'PATCH',
    body: { name: 'Alice project', footprint_interval, footprints_enabled },
  });
  expect(res.status).toBe(200);
}
async function reserved() {
  const { results } = await app.env.DB.prepare(
    'SELECT revision,previous_revision,revisions,update_count FROM project_footprints WHERE project_id=? ORDER BY revision',
  )
    .bind(project)
    .all();
  return results;
}

const mockAnalysis = (
  kind: FootprintAnalysis['kind'],
  evidence: number[] = [],
): FootprintAnalysis => ({
  kind,
  title: 'Observed changes',
  before: 'Before',
  changes: [],
  triggers: [],
  process: 'Over time',
  current: 'Current',
  meaning: '',
  interpretation: '',
  unchanged: '',
  perspectives: {
    interests: '',
    knowledge: '',
    questions: '',
    assumptions: '',
    purpose: '',
    strategy: '',
    action: '',
    environment: '',
  },
  evidence,
});
const workflow = () => new ArticleWorkflow({} as ExecutionContext, app.env);
const run = (revision: number, id = `footprint-${project}-${revision}`) =>
  workflow().run(mockEvent(id), mockStep());

it('正常保存された異なる版だけを数え、オフ中の回数と間隔変更を次の保存に引き継ぐ', async () => {
  await save(2);
  await save(5);
  await saveMemoryWithHistory(app.env, input(5), []);
  await saveMemoryWithHistory(app.env, input(90), []); // superseded
  await save(9);
  await save(15);
  await settings(5, false);
  await save(22);
  await save(28);
  await settings(1, true);
  expect((await reserved()).map((row) => row.revision)).toEqual([2, 15]);
  await save(36);
  expect(await reserved()).toEqual([
    { revision: 2, previous_revision: null, revisions: '[2]', update_count: 1 },
    { revision: 15, previous_revision: 2, revisions: '[5,9,15]', update_count: 3 },
    { revision: 36, previous_revision: 15, revisions: '[22,28,36]', update_count: 3 },
  ]);
});

it('明示操作で履歴を分割生成し、既存の予約を再利用する', async () => {
  await settings(3, false);
  for (const revision of [10, 14, 18, 30, 31]) {
    await app.env.DB.prepare(
      `INSERT INTO memory_versions(memory_id,revision,user_id,project_id,content_key,article_count,model,language,saved_at)
       VALUES(?,?,'alice',?,?,0,'memory-test','en',?)`,
    )
      .bind(
        `project-${project}`,
        revision,
        project,
        `legacy/${revision}`,
        new Date(2026, 9, revision).toISOString(),
      )
      .run();
    await app.env.MEMORY_HISTORY.put(
      `legacy/${revision}`,
      JSON.stringify({
        revision,
        saved_at: new Date(2026, 9, revision).toISOString(),
        article_count: 0,
        model: 'memory-test',
        language: 'en',
        text: input(revision).text,
        data: JSON.parse(input(revision).dataJson),
      }),
    );
  }
  await queueFootprintJobs(app.env);
  expect(await reserved()).toEqual([]);
  expect((await app.request(`${endpoint}/backfill`, { method: 'POST', user: 'bob' })).status).toBe(
    404,
  );
  expect((await app.request(`${endpoint}/backfill`, { method: 'POST' })).status).toBe(202);
  app.env.LOCAL_DEMO_ENABLED = 'true';
  await Promise.all([queueFootprintJobs(app.env), queueFootprintJobs(app.env)]);
  expect(await reserved()).toHaveLength(1);
  await run(10);
  await queueFootprintJobs(app.env);
  await run(30);
  await queueFootprintJobs(app.env);
  expect(await reserved()).toEqual([
    { revision: 10, previous_revision: null, revisions: '[10]', update_count: 1 },
    { revision: 30, previous_revision: 10, revisions: '[14,18,30]', update_count: 3 },
  ]);
  await settings(3, true);
  await save(35);
  expect(await reserved()).toHaveLength(2);
  await save(36);
  expect((await reserved()).at(-1)).toMatchObject({
    revision: 36,
    previous_revision: 30,
    revisions: '[31,35,36]',
    update_count: 3,
  });
  expect(await (await app.request(endpoint)).json()).toMatchObject({
    points: [
      { revision: 10, kind: 'beginning' },
      { revision: 30, kind: 'continuing' },
    ],
  });
});

it('期間内の根拠を変化ごとに保存し、未知の参照を拒否して同じ対象を再試行する', async () => {
  const db = app.env.DB;
  await save(1);
  await save(4);
  const recordedAt = new Date().toISOString();
  const ownerRecord = 'Seeing this review prompted me to compare our quality checks.';
  await db
    .prepare(
      `INSERT INTO questions(id,project_id,text,status,source,created_at,updated_at) VALUES
     ('ai-question',?1,'A generated question','ready','ai',?2,?2),
     ('source-question',?1,'After seeing the review, should we change how we check quality?','ready','user',?2,?2)`,
    )
    .bind(project, recordedAt)
    .run();
  const comment = await app.request('/api/v1/comments', {
    method: 'POST',
    body: {
      target_type: 'question',
      target_id: 'source-question',
      request_id: crypto.randomUUID(),
      body: ownerRecord,
    },
  });
  expect(comment.status).toBe(201);
  await save(8);
  await save(11);
  let observed:
    | {
        memories: { revision: number }[];
        records: { ref: number; label: string; kind: string; ownerRecord?: string }[];
      }
    | undefined;
  const ai = vi.fn(async (_model: string, request: { messages: { content: string }[] }) => {
    observed = JSON.parse(request.messages[1].content) as NonNullable<typeof observed>;
    return {
      response:
        observed.memories.length === 1
          ? mockAnalysis('beginning')
          : {
              ...mockAnalysis('deepening', [1]),
              changes: [{ text: 'Unknown citation', evidence: [999] }],
            },
    };
  });
  app.env.AI = { run: ai };
  await queueFootprintJobs(app.env);
  await run(1);
  await queueFootprintJobs(app.env);
  await expect(run(11)).rejects.toThrow('Invalid footprint classification or evidence');
  expect(observed?.memories.map(({ revision }) => revision)).toEqual([1, 4, 8, 11]);
  expect(observed?.records).toEqual([
    expect.objectContaining({ ref: 1, label: 'A generated question' }),
    expect.objectContaining({ ref: 2, kind: 'question' }),
    expect.objectContaining({ ref: 3, kind: 'comment', ownerRecord }),
  ]);
  expect(observed?.records.slice(0, 2).map((record) => record.ownerRecord)).toEqual([
    undefined,
    undefined,
  ]);
  expect((await app.request(`${endpoint}/11`)).status).toBe(404);
  expect(
    await db
      .prepare('SELECT revision FROM memories WHERE project_id=?')
      .bind(project)
      .first('revision'),
  ).toBe(11);

  await save(15);
  await app.request(`${endpoint}/backfill`, { method: 'POST' });
  await queueFootprintJobs(app.env);
  const retryId = await db
    .prepare('SELECT job_id FROM project_footprints WHERE project_id=? AND revision=11')
    .bind(project)
    .first<string>('job_id');
  ai.mockImplementationOnce(async (_model, request) => {
    observed = JSON.parse(request.messages[1].content) as NonNullable<typeof observed>;
    return {
      response: {
        ...mockAnalysis('deepening'),
        changes: [
          { text: 'The generated question added a comparison point', evidence: [1] },
          { text: 'A question about quality appeared', evidence: [2] },
        ],
        triggers: [
          { quote: ownerRecord, evidence: 3 },
          { quote: 'I changed the implementation.', evidence: 3 },
          { quote: 'A generated question', evidence: 1 },
          { quote: 'should we change how we check quality?', evidence: 2 },
        ],
        interpretation: 'Quality checks may be becoming a focus.',
      },
    };
  });
  await run(11, retryId!);
  expect(observed?.memories.map(({ revision }) => revision)).toEqual([1, 4, 8, 11]);
  expect(await (await app.request(`${endpoint}/11`)).json()).toMatchObject({
    kind: 'deepening',
    analysis: {
      process: 'Over time',
      interpretation: 'Quality checks may be becoming a focus.',
      changes: [
        {
          text: 'The generated question added a comparison point',
          links: [{ kind: 'question', id: 'ai-question' }],
        },
        {
          text: 'A question about quality appeared',
          links: [{ kind: 'question', id: 'source-question' }],
        },
      ],
      triggers: [ownerRecord],
      trigger_details: [
        {
          text: ownerRecord,
          links: [{ kind: 'question', id: 'source-question' }],
        },
      ],
    },
    links: [
      { kind: 'question', id: 'ai-question' },
      { kind: 'question', id: 'source-question' },
    ],
  });
  expect((await app.request(`${endpoint}/11`, { user: 'bob' })).status).toBe(404);
  await db.prepare("DELETE FROM questions WHERE id='source-question'").run();
  expect((await app.request(`${endpoint}/11`)).status).toBe(404);
  expect(await (await app.request(endpoint)).json()).toMatchObject({ points: [{ revision: 1 }] });
});

it('同じプ譜の複数局面を参照したときに、各根拠の局面を保存する', async () => {
  await settings(1, true);
  await save(1);
  const db = app.env.DB;
  const recordedAt = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO pufu_scores(id,user_id,project_id,task,input_json,score_json,editor_version,status,current_phase)
      VALUES ('phase-record','alice',?,'Compare plans','{}','{}','0.9.19','ready',2)`,
      )
      .bind(project),
    db
      .prepare(
        `INSERT INTO pufu_phases(pufu_id,number,score_json,created_at,updated_at) VALUES
      ('phase-record',1,'{"gainingGoal":{"text":"First goal"}}',?1,?1),
      ('phase-record',2,'{"gainingGoal":{"text":"Second goal"}}',?1,?1)`,
      )
      .bind(recordedAt),
  ]);
  await save(2);
  app.env.AI = {
    run: async (_model, request) => {
      const context = JSON.parse(
        (request as { messages: { content: string }[] }).messages[1].content,
      );
      if (context.beginning) return { response: mockAnalysis('beginning') };
      expect(context.records).toMatchObject([{ label: 'First goal' }, { label: 'Second goal' }]);
      return {
        response: {
          ...mockAnalysis('shift'),
          changes: [{ text: 'The goal changed', evidence: [1, 2] }],
        },
      };
    },
  };
  await queueFootprintJobs(app.env);
  await run(1);
  await queueFootprintJobs(app.env);
  await run(2);
  const links = [
    { kind: 'pufu', id: 'phase-record', phase: 1 },
    { kind: 'pufu', id: 'phase-record', phase: 2 },
  ];
  expect(await (await app.request(`${endpoint}/2`)).json()).toMatchObject({
    analysis: { changes: [{ text: 'The goal changed', links }] },
    links,
  });
});

it('旧形式で完了したAI呼び出しを再利用し、元の生成バージョンを保存する', async () => {
  await save(1);
  await queueFootprintJobs(app.env);
  const jobId = `footprint-${project}-1`;
  const analysis = {
    ...mockAnalysis('beginning'),
    changes: undefined,
    interpretation: undefined,
    evidence: undefined,
    triggers: ['An original recorded event'],
  };
  await app.env.DB.prepare(
    `INSERT INTO ai_calls(id,job_id,user_id,status,result_json) VALUES (?,?,'alice','done',?)`,
  )
    .bind(
      `${jobId}:analyze-footprint-v1:${app.env.AI_MODEL}`,
      jobId,
      JSON.stringify({
        result: { analysis, links: [], evidenceIds: [], dependencies: [], model: app.env.AI_MODEL },
      }),
    )
    .run();
  const ai = vi.fn();
  app.env.AI = { run: ai };
  await run(1);
  expect(ai).not.toHaveBeenCalled();
  expect(
    await app.env.DB.prepare('SELECT prompt_version FROM project_footprints WHERE job_id=?')
      .bind(jobId)
      .first('prompt_version'),
  ).toBe(1);
  expect(await (await app.request(`${endpoint}/1`)).json()).toMatchObject({
    analysis: { triggers: ['An original recorded event'] },
  });
});

it('AI 応答中に削除された根拠を含む結果を保存しない', async () => {
  const db = app.env.DB;
  await db
    .prepare(
      "INSERT INTO questions(id,project_id,text,status,source) VALUES ('source-question',?,'Private record','ready','user')",
    )
    .bind(project)
    .run();
  await save(2);
  app.env.AI = {
    run: async () => {
      await db.prepare("DELETE FROM questions WHERE id='source-question'").run();
      return { response: mockAnalysis('beginning', [1]) };
    },
  };
  await queueFootprintJobs(app.env);
  await run(2);
  expect(
    await db
      .prepare('SELECT result_json FROM project_footprints WHERE project_id=?')
      .bind(project)
      .first('result_json'),
  ).toBeNull();
  expect(
    await db
      .prepare('SELECT status FROM processing_jobs WHERE id=?')
      .bind(`footprint-${project}-2`)
      .first('status'),
  ).toBe('failed');
  expect(await (await app.request(endpoint)).json()).toMatchObject({ points: [] });
});

it('対象の版が保存された後に移った問いを過去の分析へ含めない', async () => {
  const db = app.env.DB;
  await settings(1, false);
  await db
    .prepare(
      `INSERT INTO questions(id,project_id,text,status,source,created_at,updated_at)
     VALUES ('moved-question','alice-second','Question from another project','ready','user',
      '2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z')`,
    )
    .run();
  await save(2);
  await db
    .prepare("UPDATE questions SET project_id=? WHERE id='moved-question'")
    .bind(project)
    .run();
  const ai = vi.fn(async (_model, request: { messages: { content: string }[] }) => {
    expect(JSON.parse(request.messages[1].content)).toMatchObject({ records: [] });
    return { response: mockAnalysis('beginning') };
  });
  app.env.AI = { run: ai };
  await app.request(`${endpoint}/backfill`, { method: 'POST' });
  await queueFootprintJobs(app.env);
  await run(2);
  expect(ai).toHaveBeenCalledOnce();
  expect(await (await app.request(endpoint)).json()).toMatchObject({ points: [{ revision: 2 }] });
});
