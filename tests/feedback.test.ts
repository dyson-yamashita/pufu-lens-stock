import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { testApp } from './helpers';

let app: Awaited<ReturnType<typeof testApp>>;
const input = () => ({
  request_id: crypto.randomUUID(),
  round: 0,
  screen: 'pufu-editor',
  category: 'unresponsive',
  detail: '第2局面で保存を押すと、成功の表示が出ても再読込で内容が戻る。',
  reasons: [{ type: 'rage_click', action: 'save' }],
  consent: true,
});
const verdict = (overrides = {}) => ({
  concrete: true,
  actionable: true,
  contains_private_information: false,
  duplicate_issue: null,
  title: '局面の保存結果を保持する',
  summary: '第2局面で保存成功後、再読込すると内容が戻る。',
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
  app.env.FEEDBACK_GITHUB_REPOSITORY = 'example/feedback';
  app.env.FEEDBACK_GITHUB_TOKEN = 'dummy';
  const ai = vi.fn(async () => ({
    response: JSON.stringify(assessment),
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }));
  app.env.AI = { run: ai };
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) =>
    Response.json(
      init?.method === 'POST'
        ? { number: 88, title: 'Created', body: '' }
        : {
            total_count: 1,
            incomplete_results: false,
            items: [{ number: 42, title: '局面の保存', body: '再読込で戻る' }],
          },
    ),
  );
  vi.stubGlobal('fetch', fetcher);
  return { ai, fetcher };
}
const rows = () =>
  app.env.DB.prepare('SELECT * FROM usability_feedback').all<{
    status: string;
    issue_number: number | null;
    hold_reason: string;
    detail: string;
    round: number;
  }>();

it('saves before assessment, uses the configured repository, and deduplicates a replay', async () => {
  const { fetcher, ai } = configure();
  const body = input();
  expect((await app.request('/api/v1/feedback', { method: 'POST', body })).status).toBe(201);
  expect((await rows()).results[0]).toMatchObject({ status: 'created', issue_number: 88 });
  expect(fetcher.mock.calls[1][0]).toBe('https://api.github.com/repos/example/feedback/issues');
  expect(JSON.stringify(fetcher.mock.calls[1][1])).not.toContain('alice');
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
  [verdict({ duplicate_issue: 42 }), 'duplicate', 42],
  [verdict({ duplicate_issue: 999 }), 'held', null],
  [verdict({ concrete: false }), 'held', null],
  [verdict({ contains_private_information: true }), 'held', null],
])(
  'aggregates valid duplicates and holds ambiguous, private or invalid output',
  async (assessment, status, number) => {
    const { fetcher } = configure(assessment);
    await app.request('/api/v1/feedback', { method: 'POST', body: input() });
    expect((await rows()).results[0]).toMatchObject({ status, issue_number: number });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it('holds an answer durably when unconfigured or external processing fails', async () => {
  await app.request('/api/v1/feedback', { method: 'POST', body: input() });
  expect((await rows()).results[0]).toMatchObject({
    status: 'held',
    hold_reason: 'integration_unconfigured',
  });
  const { fetcher } = configure();
  fetcher.mockRejectedValue(new Error('timeout'));
  expect((await app.request('/api/v1/feedback', { method: 'POST', body: input() })).status).toBe(
    201,
  );
  expect((await rows()).results[1]).toMatchObject({
    status: 'held',
    hold_reason: 'integration_failed',
  });
});

it('asks at most two follow-up questions, accepts replay safely, and uses answers for assessment', async () => {
  const { ai, fetcher } = configure(verdict({ concrete: false, follow_up: 'operation' }));
  const body = input();
  body.detail = '';
  const initial = await app.request('/api/v1/feedback', { method: 'POST', body });
  expect(await initial.json()).toMatchObject({ round: 0, follow_up: expect.any(String) });
  const reply = { ...body, round: 1, answer: '保存後も第2局面の内容を保持してほしい' };
  expect(
    await (await app.request('/api/v1/feedback', { method: 'POST', body: reply })).json(),
  ).toMatchObject({ round: 1, follow_up: expect.any(String) });
  await app.request('/api/v1/feedback', { method: 'POST', body: reply });
  expect(ai).toHaveBeenCalledTimes(2);
  await app.request('/api/v1/feedback', {
    method: 'POST',
    body: { ...body, round: 2, answer: '再読込すると内容が戻る' },
  });
  expect((await rows()).results[0]).toMatchObject({
    status: 'held',
    round: 2,
    detail: expect.stringContaining('再読込すると内容が戻る'),
  });
  expect(fetcher.mock.calls.every((call) => call[1]?.method !== 'POST')).toBe(true);
  expect(JSON.stringify(ai.mock.calls)).toContain('保存後も第2局面の内容を保持してほしい');
});

it('creates the issue when a follow-up resolves missing information', async () => {
  const { ai, fetcher } = configure(verdict({ concrete: false, follow_up: 'steps' }));
  const body = input();
  await app.request('/api/v1/feedback', { method: 'POST', body });
  ai.mockResolvedValue({
    response: JSON.stringify(verdict()),
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
  const result = await app.request('/api/v1/feedback', {
    method: 'POST',
    body: { ...body, round: 1, answer: '第2局面です' },
  });
  expect(await result.json()).toMatchObject({ follow_up: null, round: 1 });
  expect((await rows()).results[0]).toMatchObject({ status: 'created', issue_number: 88 });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(
    await app.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM ai_attempts WHERE user_id='alice' AND usage_model IS NOT NULL",
    ).first(),
  ).toEqual({ count: 2 });
});

it('includes locally recorded issues when GitHub search has not indexed a new issue yet', async () => {
  const { ai, fetcher } = configure();
  await app.request('/api/v1/feedback', { method: 'POST', body: input() });
  fetcher.mockResolvedValue(
    Response.json({ total_count: 0, incomplete_results: false, items: [] }),
  );
  ai.mockResolvedValue({
    response: JSON.stringify(verdict({ duplicate_issue: 88 })),
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
  await app.request('/api/v1/feedback', { method: 'POST', body: input() });
  expect((await rows()).results[1]).toMatchObject({ status: 'duplicate', issue_number: 88 });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(ai.mock.calls)).toContain('局面の保存結果を保持する');
});

it('does not publish an answer if the account is deleted while AI is processing it', async () => {
  const { ai, fetcher } = configure();
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
  expect(fetcher.mock.calls.every((call) => call[1]?.method !== 'POST')).toBe(true);
  expect((await rows()).results).toHaveLength(0);
});

it('does not expose arbitrary model-generated follow-up text and holds truncated searches', async () => {
  const { ai, fetcher } = configure(
    verdict({ concrete: false, follow_up: 'private issue content' }),
  );
  const response = await app.request('/api/v1/feedback', { method: 'POST', body: input() });
  expect(await response.json()).toMatchObject({ follow_up: null });
  expect((await rows()).results[0]).toMatchObject({ status: 'held' });
  fetcher.mockResolvedValue(
    Response.json({ total_count: 101, incomplete_results: false, items: [] }),
  );
  await app.request('/api/v1/feedback', { method: 'POST', body: input() });
  expect(ai).toHaveBeenCalledTimes(1);
  expect((await rows()).results[1]).toMatchObject({ hold_reason: 'search_incomplete' });
});

it('enforces consent, a strict privacy payload, authentication, account ownership and submission quotas', async () => {
  expect(
    (await app.request('/api/v1/feedback', { method: 'POST', body: input(), user: 'unknown' }))
      .status,
  ).toBe(401);
  for (const body of [
    { ...input(), consent: false },
    { ...input(), url: '/private' },
    { ...input(), reasons: [{ type: 'rage_click', action: 'private-name' }] },
  ]) {
    expect((await app.request('/api/v1/feedback', { method: 'POST', body })).status).toBe(400);
  }
  const body = input();
  for (let i = 0; i < 3; i++)
    expect(
      (await app.request('/api/v1/feedback', { method: 'POST', body: i ? input() : body })).status,
    ).toBe(201);
  expect((await app.request('/api/v1/feedback', { method: 'POST', body: input() })).status).toBe(
    429,
  );
  expect((await app.request('/api/v1/feedback', { method: 'POST', body })).status).toBe(200);
  expect(
    (await app.request('/api/v1/feedback', { method: 'POST', body, user: 'bob' })).status,
  ).toBe(201);
  await app.env.DB.prepare("DELETE FROM users WHERE id='alice'").run();
  expect((await rows()).results).toHaveLength(1);
});
