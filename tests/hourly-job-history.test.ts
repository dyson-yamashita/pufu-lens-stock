import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import worker from '../server';
import { testApp } from './helpers';

let app: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  app = await testApp();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.dispose();
});

async function tick(time: string) {
  const work: Promise<unknown>[] = [];
  worker.scheduled(
    { cron: '* * * * *', scheduledTime: Date.parse(time) } as ScheduledController,
    app.env,
    { ...app.ctx, waitUntil: (task) => work.push(task) },
  );
  await Promise.all(work);
}

it('UTCの正時だけ履歴を掃除し、同じイベントの再実行でも保護対象を残す', async () => {
  const db = app.env.DB;
  const old = new Date(Date.now() - 31 * 86400000).toISOString();
  const recent = new Date(Date.now() - 29 * 86400000).toISOString();
  await db.batch([
    ...[
      ['removed', 'done', old],
      ['failed', 'failed', old],
      ['recent', 'done', recent],
    ].map(([id, status, at]) =>
      db
        .prepare(
          "INSERT INTO processing_jobs (id,user_id,kind,target_id,revision,status,updated_at) VALUES (?,'alice','article','target',1,?,?)",
        )
        .bind(id, status, at),
    ),
    ...[
      ['removed', 'done', old],
      ['failed', 'done', old],
      ['running', 'running', old],
      ['fresh', 'failed', recent],
    ].map(([id, status, at]) =>
      db
        .prepare(
          "INSERT INTO ai_calls (id,job_id,user_id,status,updated_at) VALUES (?,?,'alice',?,?)",
        )
        .bind(id, id, status, at),
    ),
    db
      .prepare(
        "INSERT INTO ai_attempts (id,user_id,created_at) VALUES ('old','alice',?),('recent','alice',?)",
      )
      .bind(old, recent),
    db.prepare(
      "INSERT INTO job_dispatch_attempts(job_id) VALUES ('removed'),('failed'),('orphan')",
    ),
    db.prepare("INSERT INTO ai_deferrals(job_id,retry_at) VALUES ('removed',?)").bind(recent),
    db
      .prepare(
        "INSERT INTO ai_operations(id,user_id,kind,created_at) VALUES ('removed','alice','article',?)",
      )
      .bind(old),
  ]);
  const log = vi.spyOn(console, 'info');
  for (const [time, count] of [
    ['2026-11-27T23:59Z', 0],
    ['2026-11-28T00:00Z', 1],
    ['2026-11-28T00:01Z', 1],
    ['2026-11-28T00:00Z', 2],
  ] as const) {
    await db.prepare("INSERT INTO oauth_states VALUES ('expired','v','n',?)").bind(old).run();
    await tick(time);
    expect(
      await db.prepare("SELECT state_hash FROM oauth_states WHERE state_hash='expired'").first(),
    ).toBeNull();
    expect(
      log.mock.calls.filter(([r]) => r.operation === 'hourly_job_history_cleanup'),
    ).toHaveLength(count);
    expect(await db.prepare("SELECT COUNT(*) n FROM ai_attempts WHERE id='old'").first('n')).toBe(
      count ? 0 : 1,
    );
    if (!count) continue;
    for (const [table, column, expected] of [
      ['processing_jobs', 'id', ['failed', 'recent']],
      ['ai_calls', 'id', ['failed', 'fresh', 'running']],
      ['ai_attempts', 'id', ['recent']],
      ['job_dispatch_attempts', 'job_id', ['failed']],
    ] as const) {
      const rows = await db
        .prepare(`SELECT ${column} AS id FROM ${table} ORDER BY id`)
        .all<{ id: string }>();
      expect(rows.results.map((row) => row.id)).toEqual(expected);
    }
    expect(await db.prepare("SELECT id FROM ai_operations WHERE id='removed'").first()).toBeNull();
    expect(
      await db.prepare("SELECT job_id FROM ai_deferrals WHERE job_id='removed'").first(),
    ).toBeNull();
  }
});

it('正時の削除バッチが失敗しても毎分の復旧・掃除・dispatchを完了する', async () => {
  const db = app.env.DB;
  await db.batch([
    db.prepare("INSERT INTO ai_attempts(id,user_id,created_at) VALUES ('old','alice','2000')"),
    db.prepare(
      "CREATE TRIGGER fail_hourly BEFORE DELETE ON ai_attempts BEGIN SELECT RAISE(ABORT,'cleanup unavailable'); END",
    ),
    db.prepare(
      "INSERT INTO ai_calls(id,job_id,user_id,status,updated_at) VALUES ('stale','search-query','alice','running','2000')",
    ),
    db.prepare("INSERT INTO oauth_states VALUES ('expired','v','n','2000')"),
    db.prepare(
      "INSERT INTO processing_jobs(id,user_id,kind,target_id,revision) VALUES ('ready','alice','cleanup','target',1)",
    ),
  ]);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  await tick('2026-11-28T01:00Z');
  expect(error).toHaveBeenCalledWith(
    expect.objectContaining({ event: 'operation_failed', operation: 'hourly_job_history_cleanup' }),
  );
  expect(
    await db.prepare("SELECT retry_blocked FROM ai_calls WHERE id='stale'").first('retry_blocked'),
  ).toBe(1);
  expect(
    await db.prepare("SELECT state_hash FROM oauth_states WHERE state_hash='expired'").first(),
  ).toBeNull();
  expect(app.env.ARTICLE_WORKFLOW.create).toHaveBeenCalledWith({
    id: 'ready',
    params: { jobId: 'ready' },
  });
});

it('正時の質問予約は古い同世代ジョブの削除より先に行う', async () => {
  const db = app.env.DB;
  await db.batch([
    db.prepare(
      "INSERT INTO articles (id,user_id,canonical_url,source_url,title,domain,status) VALUES ('a','alice','https://example.com/a','https://example.com/a','a','example.com','ready')",
    ),
    db.prepare(
      "INSERT INTO stocks (id,user_id,project_id,article_id) VALUES ('s','alice','alice-project','a')",
    ),
    db.prepare(
      "INSERT INTO questions (id,stock_id,source,status,generation) VALUES ('q','s','ai','queued',1)",
    ),
    db.prepare(
      "INSERT INTO processing_jobs (id,user_id,kind,target_id,revision,status,updated_at) VALUES ('q-s-1','alice','question','s',1,'done','2000')",
    ),
  ]);
  await tick('2026-11-28T01:00Z');
  expect(await db.prepare("SELECT id FROM processing_jobs WHERE id='q-s-1'").first()).toBeNull();
  await tick('2026-11-28T01:01Z');
  expect(app.env.ARTICLE_WORKFLOW.create).toHaveBeenCalledWith({
    id: 'q-s-1',
    params: { jobId: 'q-s-1' },
  });
});
