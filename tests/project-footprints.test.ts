import { readdir } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  saveMemoryWithHistory,
  type MemorySaveInput,
} from '../server/features/memory/memory-history';
import { queueFootprintJobs } from '../server/features/memory/footprint-repository';
import { ArticleWorkflow } from '../server/infrastructure/jobs/workflows';
import type { Project } from '../shared/domain';
import type { FootprintAnalysis, OwnedFootprintDetail } from '../shared/footprints';
import { applyMigration, mockEvent, mockStep, testApp } from './helpers';

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

it('足あとの間隔を省略すると5回になり、選択肢にない1回は受付しない', async () => {
  const path = '/api/v1/projects';
  const response = await app.request(path, { method: 'POST', body: { name: 'New project' } });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  const { projects } = (await (await app.request(path)).json()) as { projects: Project[] };
  expect(projects.find((item) => item.id === id)?.footprint_interval).toBe(5);
  const body = { name: 'Invalid interval', footprint_interval: 1 };
  expect((await app.request(path, { method: 'POST', body })).status).toBe(400);
  expect((await app.request(`${path}/${id}`, { method: 'PATCH', body })).status).toBe(400);
});

it('既存の1回を5回へ移行し、3回・5回・10回と進行中の生成間隔は引き継ぐ', async () => {
  const migration = '0063_project_footprint_interval.sql';
  const migrations = (await readdir(new URL('../migrations/', import.meta.url)))
    .filter((name) => name.endsWith('.sql') && name < migration)
    .sort();
  const legacy = await testApp({ migrations });
  try {
    const db = legacy.env.DB;
    await db.batch([
      db.prepare("UPDATE projects SET footprint_interval=1 WHERE id='alice-project'"),
      db.prepare("UPDATE projects SET footprint_interval=10 WHERE id='alice-second'"),
      db.prepare(
        "INSERT INTO projects(id,user_id,name,footprint_interval) VALUES ('five','alice','Five',5)",
      ),
      db.prepare(
        "INSERT INTO footprint_backfills(project_id,max_revision,interval) VALUES ('alice-project',10,1)",
      ),
    ]);
    await applyMigration(db, migration);
    await db.prepare("INSERT INTO projects(id,user_id,name) VALUES ('new','alice','New')").run();
    const { results } = await db
      .prepare('SELECT id,footprint_interval FROM projects ORDER BY id')
      .all();
    expect(results).toEqual([
      { id: 'alice-project', footprint_interval: 5 },
      { id: 'alice-second', footprint_interval: 10 },
      { id: 'bob-project', footprint_interval: 3 },
      { id: 'five', footprint_interval: 5 },
      { id: 'new', footprint_interval: 5 },
    ]);
    expect(
      await db
        .prepare("SELECT interval,active FROM footprint_backfills WHERE project_id='alice-project'")
        .first(),
    ).toEqual({ interval: 1, active: 1 });
  } finally {
    await legacy.dispose();
  }
});

it('正常保存された異なる版だけを数え、オフ中の回数と間隔変更を次の保存に引き継ぐ', async () => {
  await save(2);
  await save(5);
  await saveMemoryWithHistory(app.env, input(5), []);
  await saveMemoryWithHistory(app.env, input(90), []); // superseded
  await save(9);
  await save(15);
  await save(18);
  await save(20);
  await settings(10, false);
  await save(22);
  await save(28);
  await settings(3, true);
  expect((await reserved()).map((row) => row.revision)).toEqual([2, 20]);
  await save(36);
  expect(await reserved()).toEqual([
    { revision: 2, previous_revision: null, revisions: '[2]', update_count: 1 },
    { revision: 20, previous_revision: 2, revisions: '[5,9,15,18,20]', update_count: 5 },
    { revision: 36, previous_revision: 20, revisions: '[22,28,36]', update_count: 3 },
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
  const statusPath = `${endpoint}?status_only=1`;
  const status = async () => (await app.request(statusPath)).json();
  expect(await status()).toEqual({ pending: false });
  expect((await app.request(statusPath, { user: 'bob' })).status).toBe(404);
  expect((await app.request(`${endpoint}/backfill`, { method: 'POST', user: 'bob' })).status).toBe(
    404,
  );
  expect((await app.request(`${endpoint}/backfill`, { method: 'POST' })).status).toBe(202);
  expect(await status()).toEqual({ pending: true });
  app.env.LOCAL_DEMO_ENABLED = 'true';
  await Promise.all([queueFootprintJobs(app.env), queueFootprintJobs(app.env)]);
  expect(await reserved()).toHaveLength(1);
  await run(10);
  await queueFootprintJobs(app.env);
  await run(30);
  await queueFootprintJobs(app.env);
  expect(await status()).toEqual({ pending: false });
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
  expect((await app.request(`${endpoint}/30`)).status).toBe(404);
  expect(
    (
      await app.request(`${endpoint}/30/reanalysis`, {
        method: 'POST',
        body: { generation: 0 },
      })
    ).status,
  ).toBe(409);
});

it('期間内の根拠を変化ごとに保存し、未知の参照を拒否して同じ対象を再試行する', async () => {
  const db = app.env.DB;
  await settings(3, true);
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
  await settings(3, true);
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
  await save(3);
  await save(4);
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
  await run(4);
  const links = [
    { kind: 'pufu', id: 'phase-record', phase: 1 },
    { kind: 'pufu', id: 'phase-record', phase: 2 },
  ];
  expect(await (await app.request(`${endpoint}/4`)).json()).toMatchObject({
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

it('初回の再分析で取り組みごとの根拠を保存し、公開表示に返す', async () => {
  const db = app.env.DB;
  await db.batch([
    db.prepare(`INSERT INTO articles(id,user_id,canonical_url,source_url,title,domain,status,summary_json)
      VALUES('beginning-article','alice','https://example.com/beginning','https://example.com/beginning',
      'コメント機能を追加した記録','example.com','ready','{"overview":"コメント機能を追加した。"}')`),
    db
      .prepare(
        `INSERT INTO stocks(id,user_id,project_id,article_id,note)
        VALUES('beginning-stock','alice',?,'beginning-article','PRIVATE_START_NOTE')`,
      )
      .bind(project),
    db
      .prepare(
        `INSERT INTO questions(id,project_id,text,status,source)
        VALUES('beginning-question',?,'AIとどう問いを育てるか？','ready','user')`,
      )
      .bind(project),
  ]);
  app.env.LOCAL_DEMO_ENABLED = 'true';
  await save(1);
  await queueFootprintJobs(app.env);
  await run(1);

  const publication = await app.request(`/api/v1/projects/${project}/publication`, {
    method: 'PATCH',
    body: { is_public: true, public_description: '' },
  });
  expect(publication.status).toBe(200);
  const {
    publication: { public_id },
  } = (await publication.json()) as { publication: { public_id: string } };
  const path = `${endpoint}/1`;
  expect(
    (await app.request(`${path}/reanalysis`, { method: 'POST', body: { generation: 0 } })).status,
  ).toBe(202);

  const activity = 'コメント機能を追加した。';
  const question = 'AIと問いを育てる方法について問いが立った。';
  app.env.AI = {
    run: async (_model, call) => {
      const prompt = call.messages[1].content;
      const { beginning, records } = JSON.parse(prompt) as {
        beginning: boolean;
        records: { kind: string; ref: number }[];
      };
      expect(beginning).toBe(true);
      expect(prompt).not.toContain('PRIVATE_START_NOTE');
      return {
        response: {
          ...mockAnalysis('beginning'),
          changes: [
            { text: activity, evidence: [records.find(({ kind }) => kind === 'stock')!.ref] },
            { text: question, evidence: [records.find(({ kind }) => kind === 'question')!.ref] },
          ],
        },
      };
    },
  };
  const jobId = await db
    .prepare('SELECT job_id FROM project_footprint_reanalyses WHERE project_id=? AND revision=1')
    .bind(project)
    .first<string>('job_id');
  await run(1, jobId!);

  const changes = [
    { text: activity, links: [{ kind: 'stock', id: 'beginning-stock' }] },
    { text: question, links: [{ kind: 'question', id: 'beginning-question' }] },
  ];
  const detail = (await (await app.request(path)).json()) as OwnedFootprintDetail;
  expect(detail).toMatchObject({
    analysis: { changes: [] },
    reanalysis: {
      status: 'ready',
      result: { kind: 'beginning', analysis: { before: '', changes } },
    },
    shared: { kind: 'beginning', analysis: { before: '', changes, trigger_details: [] } },
  });
  const anonymous = await app.request(`/api/public/projects/${public_id}/footprints`, {
    headers: { Cookie: '' },
  });
  expect(await anonymous.json()).toMatchObject({ items: [detail.shared] });
});

it('選択した期間だけ再分析し、重複要求を防いで元の足あとと公開用の原稿を保持する', async () => {
  const db = app.env.DB;
  await settings(3, true);
  app.env.AI = {
    run: async (_model, call) => ({
      response: mockAnalysis(
        JSON.parse(call.messages[1].content).beginning ? 'beginning' : 'deepening',
      ),
    }),
  };
  await save(1);
  await save(4);
  await db.batch([
    db.prepare(`INSERT INTO articles(id,user_id,canonical_url,source_url,title,domain,status,input_text,summary_json)
      VALUES('source-a','alice','https://example.com/a','https://example.com/a','公開ストック','example.com','ready',
        'PRIVATE_SOURCE_TEXT','{"overview":"公開要約","keyPoints":[],"topics":[]}')`),
    db
      .prepare(
        `INSERT INTO stocks(id,user_id,project_id,article_id,note)
      VALUES('source-stock','alice',?,'source-a','PRIVATE_STOCK_NOTE')`,
      )
      .bind(project),
    db
      .prepare(
        `INSERT INTO questions(id,project_id,text,note,status,source)
      VALUES('source-q',?,'公開の問い','PRIVATE_QUESTION_NOTE','ready','user')`,
      )
      .bind(project),
  ]);
  expect(
    (
      await app.request('/api/v1/comments', {
        method: 'POST',
        body: {
          target_type: 'question',
          target_id: 'source-q',
          request_id: crypto.randomUUID(),
          body: 'PRIVATE_COMMENT',
        },
      })
    ).status,
  ).toBe(201);
  for (const revision of [8, 11, 16]) await save(revision);
  await queueFootprintJobs(app.env);
  await run(1);
  await queueFootprintJobs(app.env);
  await run(11);
  const path = `${endpoint}/11`;
  const request = (generation: number, user = 'alice') =>
    app.request(`${path}/reanalysis`, { method: 'POST', body: { generation }, user });
  const detail = async () => (await (await app.request(path)).json()) as OwnedFootprintDetail;
  const { reanalysis: initial, ...original } = await detail();
  expect(initial).toEqual({ generation: 0, status: 'idle', result: null });
  const publication = await app.request(`/api/v1/projects/${project}/publication`, {
    method: 'PATCH',
    body: { is_public: true, public_description: '' },
  });
  const {
    publication: { public_id },
  } = (await publication.json()) as { publication: { public_id: string } };
  const copy = { title: 'Published title', summary: 'Approved summary' };
  expect((await app.request(`${path}/publication`, { method: 'PATCH', body: copy })).status).toBe(
    200,
  );
  const before = await reserved();
  const readPublic = async () =>
    (
      await app.request(`/api/public/projects/${public_id}/footprints`, {
        headers: { Cookie: '' },
      })
    ).json();
  const publicBefore = await readPublic();
  expect(publicBefore).toMatchObject({ items: [{ ...copy, kind: 'deepening' }] });
  expect((await detail()).shared).toMatchObject(copy);

  expect((await request(0, 'bob')).status).toBe(404);
  expect(
    (
      await app.request(`${path}/reanalysis`, {
        method: 'POST',
        body: { generation: 0 },
        headers: { Cookie: '' },
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await app.request(`${path}/reanalysis`, {
        method: 'POST',
        body: { generation: 0 },
        headers: { Origin: 'https://outside.example' },
      })
    ).status,
  ).toBe(403);
  expect((await Promise.all([request(0), request(0)])).map((res) => res.status).sort()).toEqual([
    202, 409,
  ]);
  expect((await request(1)).status).toBe(409);
  expect((await detail()).reanalysis).toEqual({ generation: 1, status: 'pending', result: null });
  const jobId = () =>
    db
      .prepare('SELECT job_id FROM project_footprint_reanalyses WHERE project_id=? AND revision=11')
      .bind(project)
      .first<string>('job_id');
  const ai = vi.fn(async (_model: string, call: { messages: { content: string }[] }) => {
    const prompt = call.messages[1].content;
    const { period, memories, records } = JSON.parse(prompt) as {
      period: string[];
      memories: { revision: number }[];
      records: { ref: number; label: string; kind: string }[];
    };
    expect(period).toEqual([original.start_at, original.end_at]);
    expect(memories).toBeUndefined();
    expect(prompt).not.toMatch(/PRIVATE_|Interest \d|Observed changes/);
    expect(prompt).toContain('公開要約');
    expect(prompt).toContain('公開の問い');
    const stock = records.find(({ kind }) => kind === 'stock')!;
    return {
      response: {
        ...mockAnalysis('shift'),
        changes: [{ text: 'A documented change', evidence: [stock.ref] }],
      },
    };
  });
  app.env.AI = { run: ai };
  await run(11, (await jobId())!);
  expect(ai).toHaveBeenCalledTimes(1);
  const result = await detail();
  expect(result).toMatchObject({
    analysis: original.analysis,
    kind: original.kind,
    reanalysis: {
      generation: 1,
      status: 'ready',
      result: {
        revision: 11,
        end_at: original.end_at,
        kind: 'shift',
        analysis: { title: 'Observed changes' },
      },
    },
  });
  expect(result.shared).toMatchObject({
    kind: 'shift',
    analysis: {
      changes: [{ text: 'A documented change', links: [{ kind: 'stock', id: 'source-stock' }] }],
    },
  });
  const publicWithAnalysis = await readPublic();
  expect(publicWithAnalysis).toEqual({
    items: [{ id: expect.any(String), ...result.shared }],
    page: 1,
    has_more: false,
  });
  expect((await request(0)).status).toBe(409); // A delayed duplicate after completion.
  expect((await request(1)).status).toBe(202);
  expect((await detail()).reanalysis).toMatchObject({
    generation: 2,
    status: 'pending',
    result: result.reanalysis!.result,
  });
  app.env.AI = { run: async () => ({ response: mockAnalysis('deepening', [999]) }) };
  const failedJob = (await jobId())!;
  await expect(run(11, failedJob)).rejects.toThrow('Invalid footprint classification or evidence');
  expect((await detail()).reanalysis).toMatchObject({
    generation: 2,
    status: 'failed',
    result: result.reanalysis!.result,
  });
  await db.prepare("DELETE FROM comments WHERE target_id='source-q'").run();
  await db.prepare("UPDATE stocks SET note='更新した個人メモ' WHERE id='source-stock'").run();
  expect(await detail()).toMatchObject({ original_available: false, shared: result.shared });
  expect(await readPublic()).toEqual(publicWithAnalysis);
  // A replaced attempt may have stopped between cache and checkpoint commits.
  await db
    .prepare(`UPDATE ai_calls SET result_json='{"interrupted":true}' WHERE job_id=?`)
    .bind(failedJob)
    .run();
  expect((await request(2)).status).toBe(202);
  expect(
    await db
      .prepare('SELECT result_json FROM ai_calls WHERE job_id=?')
      .bind(failedJob)
      .first('result_json'),
  ).toBeNull();
  app.env.AI = { run: async () => ({ response: mockAnalysis('continuing') }) };
  await run(11, (await jobId())!);
  expect((await app.request(path)).status).toBe(404);
  expect(await (await app.request(endpoint)).json()).toMatchObject({
    points: [{ revision: 1 }, { revision: 11, kind: 'continuing' }],
  });
  expect(await reserved()).toEqual(before);
  expect(await readPublic()).toEqual({
    items: [{ id: expect.any(String), kind: 'continuing', end_at: original.end_at }],
    page: 1,
    has_more: false,
  });
  expect(
    await db
      .prepare(
        'SELECT title,summary FROM project_footprint_publications WHERE project_id=? AND revision=11',
      )
      .bind(project)
      .first(),
  ).toEqual(copy);
  expect(
    await db
      .prepare('SELECT COUNT(*) AS count FROM processing_jobs WHERE target_id=? AND id LIKE ?')
      .bind(project, 'footprint-reanalysis-%')
      .first('count'),
  ).toBe(3);
});

it('公開プロジェクトから非公開に戻した後の足あとを、個人用の根拠の版で生成する', async () => {
  const changeVisibility = (is_public: boolean) =>
    app.request(`/api/v1/projects/${project}/publication`, {
      method: 'PATCH',
      body: { is_public, public_description: '' },
    });
  await settings(3, true);
  await app.env.DB.prepare(
    `INSERT INTO questions(id,project_id,text,status,source)
    VALUES('previous-public-question',?,'An earlier public question','ready','user')`,
  )
    .bind(project)
    .run();
  app.env.AI = {
    run: async (_model, call) => ({
      response: mockAnalysis(
        JSON.parse(call.messages[1].content).beginning ? 'beginning' : 'deepening',
      ),
    }),
  };
  expect((await changeVisibility(true)).status).toBe(200);
  await save(1);
  await queueFootprintJobs(app.env);
  await run(1);
  expect(await (await app.request(`${endpoint}/1`)).json()).toMatchObject({
    shared: { kind: 'beginning' },
  });
  expect((await changeVisibility(false)).status).toBe(200);
  await save(2);
  await save(3);
  await save(4);
  await queueFootprintJobs(app.env);
  await run(4);
  expect(await (await app.request(`${endpoint}/4`)).json()).toMatchObject({
    kind: 'deepening',
    shared: null,
  });
});

it.each(['settings', 'deletion'] as const)(
  '再分析の権限失効後に結果を保存しない (%s)',
  async (revocation) => {
    app.env.LOCAL_DEMO_ENABLED = 'true';
    const db = app.env.DB;
    await save(1);
    await queueFootprintJobs(app.env);
    await run(1);
    const path = `${endpoint}/1`;
    const start = (generation: number) =>
      app.request(`${path}/reanalysis`, {
        method: 'POST',
        body: { generation },
      });
    const memoryUpdates = (enabled: boolean) =>
      db
        .prepare('UPDATE projects SET include_in_user_memory=? WHERE id=?')
        .bind(Number(enabled), project)
        .run();
    const job = async () =>
      (await db
        .prepare('SELECT job_id FROM project_footprint_reanalyses WHERE project_id=?')
        .bind(project)
        .first<string>('job_id'))!;
    const ai = vi.fn();
    app.env.AI = { run: ai };

    await memoryUpdates(false);
    expect((await start(0)).status).toBe(409);
    await memoryUpdates(true);
    expect((await start(0)).status).toBe(202);
    await memoryUpdates(false);
    await run(1, await job());
    expect(ai).not.toHaveBeenCalled();
    await memoryUpdates(true);
    expect((await start(1)).status).toBe(202);
    const inFlight = await job();

    ai.mockImplementation(async () => {
      if (revocation === 'settings') {
        await memoryUpdates(false);
        await memoryUpdates(true);
      } else await db.prepare('DELETE FROM projects WHERE id=?').bind(project).run();
      return { response: mockAnalysis('beginning') };
    });
    await run(1, inFlight);
    expect(ai).toHaveBeenCalledTimes(1);
    expect(
      await db
        .prepare('SELECT result_json FROM ai_calls WHERE job_id=?')
        .bind(inFlight)
        .first('result_json'),
    ).toBeNull();
    const stored = await db
      .prepare('SELECT result_json FROM project_footprint_reanalyses WHERE job_id=?')
      .bind(inFlight)
      .first();
    if (revocation === 'deletion') {
      expect(stored).toBeNull();
      expect((await app.request(path)).status).toBe(404);
    } else {
      expect(stored).toEqual({ result_json: null });
      await memoryUpdates(true);
      expect(await (await app.request(path)).json()).toMatchObject({
        kind: 'beginning',
        reanalysis: { generation: 2, status: 'failed', result: null },
      });
    }
  },
);

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
  await settings(3, false);
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
