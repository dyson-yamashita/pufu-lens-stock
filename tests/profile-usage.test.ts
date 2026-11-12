import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { applyMigration, testApp } from './helpers';
import { readdir } from 'node:fs/promises';
import { createApp } from '../server/api';
import { saveAiUsage } from '../server/ai-neurons';
import type { User } from '../shared/domain';
import type { ProfileUsage } from '../shared/profile-usage';

let app: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  app = await testApp();
  await app.env.DB.prepare("UPDATE sessions SET expires_at='2100-01-01T00:00:00.000Z'").run();
});
afterEach(async () => {
  vi.useRealTimers();
  await app.dispose();
});
const usage = async (user = 'alice') => {
  const response = await app.request('/api/v1/me/usage', { user });
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  return response.json() as Promise<ProfileUsage>;
};

it('日本時間の月曜・月初を含み、全プロジェクトを所有者別に登録日で集計する', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T03:00:00.000Z'));
  const dates = [
    '2026-10-31T14:59:59.999Z',
    '2026-10-31T15:00:00.000Z',
    '2026-11-08T14:59:59.999Z',
    '2026-11-08T15:00:00.000Z',
    '2026-11-12T02:59:59.999Z',
  ];
  await app.env.DB.prepare("UPDATE projects SET show_in_all_lists=0 WHERE id='alice-second'").run();
  for (const [index, date] of dates.entries()) {
    const project = index % 2 ? 'alice-second' : 'alice-project';
    await app.env.DB.batch([
      app.env.DB.prepare(
        `INSERT INTO articles(id,user_id,canonical_url,source_url,title,domain)
        VALUES (?,'alice',?,?,'test','example.com')`,
      ).bind(`a${index}`, `https://example.com/${index}`, `https://example.com/${index}`),
      app.env.DB.prepare(
        "INSERT INTO stocks(id,user_id,project_id,article_id,created_at) VALUES (?,'alice',?,?,?)",
      ).bind(`s${index}`, project, `a${index}`, date),
      app.env.DB.prepare(
        `INSERT INTO questions(id,project_id,source,text,status,created_at)
        VALUES (?,?,'user','問い','ready',?)`,
      ).bind(`q${index}`, project, date),
      app.env.DB.prepare(
        `INSERT INTO pufu_scores(id,user_id,project_id,task,input_json,editor_version,created_at)
        VALUES (?,'alice',?,'プ譜','{}','0.9.19',?)`,
      ).bind(`p${index}`, project, date),
      app.env.DB.prepare(
        "INSERT INTO ai_attempts(id,user_id,created_at) VALUES (?,'alice',?)",
      ).bind(`attempt${index}`, date),
    ]);
    if (index < 4)
      await saveAiUsage(
        app.env,
        'alice',
        `attempt${index}`,
        'fixture-model',
        (index + 1) * 1_000_000,
        true,
      );
  }
  await app.env.DB.batch([
    app.env.DB.prepare(
      "INSERT INTO pufu_phases(pufu_id,number,score_json,created_at,updated_at) VALUES ('p4',2,'{}',?,?)",
    ).bind(dates[4], dates[4]),
    app.env.DB.prepare(
      "INSERT INTO questions(id,project_id,source,text,status,created_at) VALUES ('bob-q','bob-project','user','別人','ready',?)",
    ).bind(dates[4]),
    app.env.DB.prepare(
      "INSERT INTO ai_attempts(id,user_id,created_at) VALUES ('bob-ai','bob',?)",
    ).bind(dates[4]),
  ]);
  await saveAiUsage(app.env, 'bob', 'bob-ai', 'fixture-model', 7_000_000, true);
  const result = await usage();
  expect(result).toEqual({
    timezone: 'Asia/Tokyo',
    as_of: '2026-11-12T03:00:00.000Z',
    periods: {
      week: {
        since: dates[3],
        stocks: 2,
        questions: 2,
        pufus: 2,
        ai_neurons: 4,
        ai_unmeasured_calls: 1,
      },
      month: {
        since: dates[1],
        stocks: 4,
        questions: 4,
        pufus: 4,
        ai_neurons: 9,
        ai_unmeasured_calls: 1,
      },
      all: {
        since: null,
        stocks: 5,
        questions: 5,
        pufus: 5,
        ai_neurons: 10,
        ai_unmeasured_calls: 1,
      },
    },
  });
  expect((await usage('bob')).periods.all).toEqual({
    since: null,
    stocks: 0,
    questions: 1,
    pufus: 0,
    ai_neurons: 7,
    ai_unmeasured_calls: 0,
  });
  await app.env.DB.batch([
    app.env.DB.prepare("DELETE FROM stocks WHERE id='s4'"),
    app.env.DB.prepare("DELETE FROM questions WHERE id='q4'"),
    app.env.DB.prepare("DELETE FROM pufu_scores WHERE id='p4'"),
    app.env.DB.prepare('DELETE FROM ai_attempts'),
  ]);
  expect((await usage()).periods.week).toEqual({
    since: dates[3],
    stocks: 1,
    questions: 1,
    pufus: 1,
    ai_neurons: 4,
    ai_unmeasured_calls: 1,
  });
});

it.each([
  ['2026-11-30T15:00:00.000Z', '2026-11-29T15:00:00.000Z', '2026-11-30T15:00:00.000Z'],
  ['2026-12-06T15:00:00.000Z', '2026-12-06T15:00:00.000Z', '2026-11-30T15:00:00.000Z'],
  ['2027-01-01T00:00:00.000Z', '2026-12-27T15:00:00.000Z', '2026-12-31T15:00:00.000Z'],
])('月替わり・週替わり・年替わり: %s', async (now, week, month) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(now));
  const result = await usage();
  expect(result.periods.week).toEqual({
    since: week,
    stocks: 0,
    questions: 0,
    pufus: 0,
    ai_neurons: 0,
    ai_unmeasured_calls: 0,
  });
  expect(result.periods.month.since).toBe(month);
});

it('旧履歴は未計測として移行し、詳細削除後も履歴を保持し、退会時に削除する', async () => {
  await app.dispose();
  app = await testApp({
    migrations: (await readdir(new URL('../migrations/', import.meta.url)))
      .filter((name) => name.endsWith('.sql') && name < '0048_ai_neurons.sql')
      .sort(),
  });
  await app.env.DB.batch([
    app.env.DB.prepare('DROP TRIGGER record_ai_usage'),
    app.env.DB.prepare('DROP TABLE ai_usage_daily'),
    app.env.DB.prepare('DROP INDEX pufu_usage_owner'),
    app.env.DB.prepare(`INSERT INTO ai_attempts(id,user_id,created_at) VALUES
      ('old1','alice','2026-11-08T14:59:59.999Z'),
      ('old2','alice','2026-11-08T15:00:00.000Z'),
      ('old3','alice','2026-11-08T16:00:00.000Z')`),
  ]);
  await applyMigration(app.env.DB, '0047_profile_usage.sql');
  await app.env.DB.prepare(
    `INSERT INTO ai_attempts(id,user_id,created_at) VALUES
    ('retry','alice','2026-11-08T17:00:00.000Z'),
    ('embedding-fixture','alice','2026-11-08T18:00:00.000Z')`,
  ).run();
  expect(
    (await app.env.DB.prepare('SELECT day,calls FROM ai_usage_daily ORDER BY day').all()).results,
  ).toEqual([
    { day: '2026-11-08', calls: 1 },
    { day: '2026-11-09', calls: 4 },
  ]);
  await applyMigration(app.env.DB, '0048_ai_neurons.sql');
  await app.env.DB.prepare('DELETE FROM ai_attempts').run();
  expect((await usage()).periods.all).toMatchObject({ ai_neurons: 0, ai_unmeasured_calls: 5 });
  expect((await app.request('/api/v1/me', { method: 'DELETE', body: {} })).status).toBe(200);
  expect((await app.env.DB.prepare('SELECT * FROM ai_usage_daily').all()).results).toEqual([]);
});

it('匿名・ショートカット・MCPによる個人の利用状況の取得を拒否する', async () => {
  expect((await app.request('/api/v1/me/usage', { headers: { Cookie: '' } })).status).toBe(401);
  const created = await app.request('/api/v1/tokens', {
    method: 'POST',
    body: { name: 'usage test' },
  });
  const { token } = (await created.json()) as { token: string };
  expect(
    (
      await app.request('/api/v1/me/usage', {
        headers: { Cookie: '', Authorization: `Bearer ${token}` },
      })
    ).status,
  ).toBe(403);
  const user = await app.env.DB.prepare("SELECT * FROM users WHERE id='alice'").first<User>();
  const mcp = createApp({ kind: 'mcp', user: user!, tokenProjectId: null });
  expect(
    (await mcp.request(`${app.env.APP_URL}/api/v1/me/usage`, {}, app.env, app.ctx)).status,
  ).toBe(403);
});
