import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { applyMigration, testApp } from './helpers';

let app: Awaited<ReturnType<typeof testApp>>;
const input = () => ({
  request_id: crypto.randomUUID(),
  owner_id: 'alice',
  round: 0,
  screen: 'pufu-editor',
  category: 'unresponsive',
  detail: '第2局面で保存成功の表示が出ても、再読込すると内容が戻る。',
  reasons: [{ type: 'rage_click', action: 'save' }],
  consent: true,
  finish: false,
});
const verdict = (overrides = {}) => ({
  concrete: true,
  actionable: true,
  contains_private_information: false,
  title: '保存結果を保持する',
  summary: '再読込すると保存内容が戻る。',
  reproduction_steps: '第2局面で保存後に再読込する',
  expected_behavior: '保存内容が残る',
  actual_behavior: '保存内容が戻る',
  follow_up: null,
  ...overrides,
});
beforeEach(async () => {
  app = await testApp();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await app.dispose();
});
function configure(assessment = verdict()) {
  const ai = vi.fn(async () => ({
    response: JSON.stringify(assessment),
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }));
  app.env.AI = { run: ai };
  const fetcher = vi.fn(() => {
    throw new Error('No external HTTP is permitted');
  });
  vi.stubGlobal('fetch', fetcher);
  return { ai, fetcher };
}
const rows = () =>
  app.env.DB.prepare('SELECT * FROM usability_feedback').all<{
    status: string;
    review_status: string;
    hold_reason: string;
    detail: string;
    conversation: string;
    title: string;
    summary: string;
    reproduction_steps: string;
    expected_behavior: string;
    actual_behavior: string;
    round: number;
  }>();

it('preserves the entire unresolved reply and separately saves manual context in the displayed language', async () => {
  delete app.env.AI;
  const detail = '未解決'.repeat(333);
  const context = { question: '質問'.repeat(500), topic: '画像の保存', section: 'manual-pufu-10' };
  const response = await app.request('/api/v1/feedback', {
    method: 'POST',
    body: {
      ...input(),
      screen: 'manual',
      language: 'en',
      category: 'navigation',
      detail,
      manual_context: context,
      finish: true,
    },
  });
  expect(response.status).toBe(201);
  const saved = await app.env.DB.prepare(
    'SELECT screen,language,detail,conversation FROM usability_feedback',
  ).first<{ screen: string; language: string; detail: string; conversation: string }>();
  expect(saved).toMatchObject({ screen: 'manual', language: 'en', detail });
  expect(JSON.parse(saved!.conversation)).toContainEqual({ role: 'user', text: context.question });
  expect(JSON.parse(saved!.conversation)).toContainEqual({ role: 'user', text: detail });
});

it('stores fixed confusion metadata with the conversation without requiring AI', async () => {
  delete app.env.AI;
  const reasons = [
    { type: 'exploration_repeat', action: 'download' },
    { type: 'navigation_loop', action: 'phase' },
  ];
  const body = {
    ...input(),
    category: 'navigation',
    detail: 'どの操作を選ぶか迷いました。',
    reasons,
    finish: true,
  };
  expect((await app.request('/api/v1/feedback', { method: 'POST', body })).status).toBe(201);
  const saved = await app.env.DB.prepare(
    'SELECT reasons, category, status FROM usability_feedback',
  ).first<{ reasons: string; category: string; status: string }>();
  expect(JSON.parse(saved!.reasons)).toEqual(reasons);
  expect(saved).toMatchObject({ category: 'navigation', status: 'awaiting_review' });
});

it('stores an issue-equivalent maintenance report in D1 without GitHub or external HTTP and deduplicates replays', async () => {
  const { fetcher, ai } = configure();
  const body = input();
  expect((await app.request('/api/v1/feedback', { method: 'POST', body })).status).toBe(201);
  expect((await rows()).results[0]).toMatchObject({
    status: 'awaiting_review',
    review_status: 'unreviewed',
    title: '保存結果を保持する',
    reproduction_steps: '第2局面で保存後に再読込する',
    expected_behavior: '保存内容が残る',
    actual_behavior: '保存内容が戻る',
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect((await app.request('/api/v1/feedback', { method: 'POST', body })).status).toBe(200);
  expect(ai).toHaveBeenCalledTimes(1);
  expect(
    await app.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM ai_attempts WHERE user_id='alice' AND usage_model IS NOT NULL",
    ).first(),
  ).toEqual({ count: 1 });
  expect((await rows()).results).toHaveLength(1);
});

it.each([
  [verdict({ concrete: false, actionable: false }), 'awaiting_review', 'needs_review'],
  [verdict({ contains_private_information: true }), 'held', 'private_information'],
])(
  'preserves incomplete or sensitive reports for maintenance',
  async (assessment, status, hold_reason) => {
    configure(assessment);
    await app.request('/api/v1/feedback', { method: 'POST', body: input() });
    expect((await rows()).results[0]).toMatchObject({
      status,
      hold_reason,
      review_status: 'unreviewed',
    });
  },
);

it('saves without AI configuration, asks briefly, and lets the user finish immediately', async () => {
  const body = input();
  const initial = await app.request('/api/v1/feedback', { method: 'POST', body });
  expect(await initial.json()).toMatchObject({ round: 0, follow_up: 'expected' });
  const finish = { ...body, finish: true };
  expect(
    await (await app.request('/api/v1/feedback', { method: 'POST', body: finish })).json(),
  ).toMatchObject({ follow_up: null });
  await app.request('/api/v1/feedback', { method: 'POST', body: finish });
  expect((await rows()).results).toHaveLength(1);
  expect((await rows()).results[0]).toMatchObject({
    status: 'awaiting_review',
    detail: body.detail,
    hold_reason: 'ai_unconfigured',
  });
});

it('asks at most two questions and saves a complete conversation with idempotent replies', async () => {
  const { ai, fetcher } = configure(verdict({ concrete: false, follow_up: 'operation' }));
  const body = input();
  expect(
    await (await app.request('/api/v1/feedback', { method: 'POST', body })).json(),
  ).toMatchObject({ round: 0, follow_up: 'operation' });
  const reply = { ...body, round: 1, answer: '保存ボタンです' };
  await app.request('/api/v1/feedback', { method: 'POST', body: reply });
  await app.request('/api/v1/feedback', { method: 'POST', body: reply });
  expect(ai).toHaveBeenCalledTimes(2);
  await app.request('/api/v1/feedback', {
    method: 'POST',
    body: { ...body, round: 2, answer: '再読込後に戻る' },
  });
  const row = (await rows()).results[0];
  expect(row).toMatchObject({
    status: 'awaiting_review',
    round: 2,
    detail: expect.stringContaining('再読込後に戻る'),
  });
  expect(JSON.parse(row.conversation)).toContainEqual({
    role: 'pufi',
    text: 'どの操作でお困りでしたか？',
  });
  expect(JSON.parse(row.conversation)).toContainEqual({ role: 'user', text: '保存ボタンです' });
  expect(fetcher).not.toHaveBeenCalled();
});

it('saves the final reply when finishing, even when AI would ask another question', async () => {
  configure(verdict({ concrete: false, follow_up: 'steps' }));
  const body = input();
  await app.request('/api/v1/feedback', { method: 'POST', body });
  const result = await app.request('/api/v1/feedback', {
    method: 'POST',
    body: { ...body, round: 1, answer: '第2局面です', finish: true },
  });
  expect(await result.json()).toMatchObject({ follow_up: null, round: 1 });
  expect((await rows()).results[0]).toMatchObject({
    status: 'awaiting_review',
    detail: expect.stringContaining('第2局面です'),
  });
});

it('keeps raw conversations when AI fails or returns an arbitrary question', async () => {
  const { ai } = configure(verdict({ follow_up: 'arbitrary text' }));
  await app.request('/api/v1/feedback', { method: 'POST', body: input() });
  expect((await rows()).results[0]).toMatchObject({
    status: 'awaiting_review',
    hold_reason: 'assessment_failed',
  });
  ai.mockRejectedValue(new Error('timeout'));
  await app.request('/api/v1/feedback', { method: 'POST', body: input() });
  expect((await rows()).results[1]).toMatchObject({
    status: 'awaiting_review',
    hold_reason: 'assessment_failed',
  });
});

it('does not resurrect a deleted account or its conversation after delayed AI processing', async () => {
  const { ai } = configure();
  let started!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const proceed = new Promise<void>((resolve) => {
    release = resolve;
  });
  ai.mockImplementation(async () => {
    started();
    await proceed;
    return {
      response: JSON.stringify(verdict()),
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
  });
  const pending = app.request('/api/v1/feedback', { method: 'POST', body: input() });
  await waiting;
  try {
    await app.env.DB.prepare("DELETE FROM users WHERE id='alice'").run();
  } finally {
    release();
  }
  expect((await pending).status).toBe(410);
  expect((await rows()).results).toHaveLength(0);
});

it('rejects drafts and frozen retries after a different account signs in', async () => {
  configure();
  const body = input();
  await app.request('/api/v1/feedback', { method: 'POST', body });
  expect(
    (await app.request('/api/v1/feedback', { method: 'POST', body, user: 'bob' })).status,
  ).toBe(409);
  expect((await rows()).results).toHaveLength(1);
});

it('keeps the global 24-hour quota consumed after deleting an account', async () => {
  const { ai } = configure();
  await app.env.DB.batch(
    Array.from({ length: 57 }, (_, i) =>
      app.env.DB.prepare('INSERT INTO feedback_global_usage(id,created_at) VALUES(?,?)').bind(
        `anonymous-${i}`,
        new Date().toISOString(),
      ),
    ),
  );
  for (let i = 0; i < 3; i++)
    await app.request('/api/v1/feedback', { method: 'POST', body: input() });
  await app.env.DB.prepare("DELETE FROM users WHERE id='alice'").run();
  expect((await rows()).results).toHaveLength(0);
  expect(
    (
      await app.request('/api/v1/feedback', {
        method: 'POST',
        body: { ...input(), owner_id: 'bob' },
        user: 'bob',
      })
    ).status,
  ).toBe(429);
  expect(ai).toHaveBeenCalledTimes(3);
});

it('enforces consent, fixed metadata, ownership, authentication, quotas and cascade deletion', async () => {
  expect(
    (await app.request('/api/v1/feedback', { method: 'POST', body: input(), user: 'unknown' }))
      .status,
  ).toBe(401);
  for (const body of [
    { ...input(), consent: false },
    { ...input(), url: '/private' },
    { ...input(), reasons: [{ type: 'rage_click', action: 'private-name' }] },
  ])
    expect((await app.request('/api/v1/feedback', { method: 'POST', body })).status).toBe(400);
  // Seed 49 recent conversations and one outside the rolling 24-hour window.
  await app.env.DB.batch([
    app.env.DB.prepare(
      `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<49)
       INSERT INTO usability_feedback(id,user_id,request_id,category,detail,reasons,created_at,updated_at)
       SELECT 'quota-'||x,'alice','quota-'||x,'other','','[]',?,? FROM n`,
    ).bind(new Date().toISOString(), new Date().toISOString()),
    app.env.DB.prepare(
      `INSERT INTO usability_feedback(id,user_id,request_id,category,detail,reasons,created_at,updated_at)
       VALUES('expired-quota','alice','expired-quota','other','','[]',?,?)`,
    ).bind(new Date(Date.now() - 86400000 - 1000).toISOString(), new Date().toISOString()),
  ]);
  const body = input();
  expect((await app.request('/api/v1/feedback', { method: 'POST', body })).status).toBe(201);
  expect((await app.request('/api/v1/feedback', { method: 'POST', body: input() })).status).toBe(
    429,
  );
  expect((await app.request('/api/v1/feedback', { method: 'POST', body })).status).toBe(200);
  expect(
    (
      await app.request('/api/v1/feedback', {
        method: 'POST',
        body: { ...body, owner_id: 'bob' },
        user: 'bob',
      })
    ).status,
  ).toBe(201);
  await app.env.DB.prepare("DELETE FROM users WHERE id='alice'").run();
  expect((await rows()).results).toHaveLength(1);
});

it.each([
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'desktop'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile', 'mobile'],
  ['Mozilla/5.0 (Linux; Android 14; Pixel) Mobile', 'mobile'],
  ['Mozilla/5.0 (iPad; CPU OS 18_0) Mobile', 'tablet'],
  ['Mozilla/5.0 (Linux; Android 14; Tablet)', 'tablet'],
  ['Mozilla/5.0 (Linux; Android 14; SM-X700)', 'tablet'],
])(
  'saves bounded analytics context for %s and preserves initial context on replies',
  async (ua, device) => {
    const body = { ...input(), page_path: '/p/test?secret=hidden#fragment', viewport: '390x844' };
    const response = await app.request('/api/v1/feedback', {
      method: 'POST',
      body,
      headers: { 'User-Agent': ua, 'CF-Connecting-IP': '192.0.2.1' },
      cf: { country: 'JP' },
    });
    expect(response.status).toBe(201);
    await app.request('/api/v1/feedback', {
      method: 'POST',
      body: {
        ...body,
        round: 1,
        answer: '保存されること',
        page_path: '/elsewhere',
        viewport: '800x600',
      },
      headers: { 'User-Agent': 'Other' },
      cf: { country: 'US' },
    });
    const saved = (await rows()).results[0];
    expect(saved).toMatchObject({
      page_path: '/p/test',
      viewport: '390x844',
      device_type: device,
      country: 'JP',
    });
    for (const value of ['secret=hidden', '#fragment', ua, '192.0.2.1'])
      expect(JSON.stringify(saved)).not.toContain(value);
  },
);

it('accepts old clients and does not trust country headers', async () => {
  expect(
    (
      await app.request('/api/v1/feedback', {
        method: 'POST',
        body: input(),
        headers: { 'CF-IPCountry': 'JP' },
      })
    ).status,
  ).toBe(201);
  expect((await rows()).results[0]).toMatchObject({
    page_path: null,
    viewport: null,
    device_type: null,
    country: null,
  });
});

it.each([
  { page_path: 'https://example.com/private' },
  { page_path: '//example.com/private' },
  { page_path: '/a\\b' },
  { viewport: '0x844' },
  { viewport: '390x844?secret' },
  { device_type: 'mobile' },
  { country: 'JP' },
])('rejects invalid or client-forged context %j', async (context) => {
  expect(
    (await app.request('/api/v1/feedback', { method: 'POST', body: { ...input(), ...context } }))
      .status,
  ).toBe(400);
  expect((await rows()).results).toHaveLength(0);
});

it('adds nullable columns without changing existing reports or cascade deletion', async () => {
  for (const column of ['page_path', 'device_type', 'country', 'viewport'])
    await app.env.DB.prepare(`ALTER TABLE usability_feedback DROP COLUMN ${column}`).run();
  await app.env.DB.prepare(
    `INSERT INTO usability_feedback
    (id,user_id,request_id,category,detail,reasons,created_at,updated_at)
    VALUES('historical','alice','historical','other','old report','[]','2026-01-01','2026-01-01')`,
  ).run();
  await applyMigration(app.env.DB, '0051_feedback_analytics_context.sql');
  expect((await rows()).results[0]).toMatchObject({
    detail: 'old report',
    page_path: null,
    device_type: null,
    country: null,
    viewport: null,
  });
  await app.env.DB.prepare("DELETE FROM users WHERE id='alice'").run();
  expect((await rows()).results).toHaveLength(0);
});
