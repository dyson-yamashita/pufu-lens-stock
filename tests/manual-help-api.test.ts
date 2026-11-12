import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { testApp } from './helpers';
let app: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  app = await testApp();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await app.dispose();
});
const body = () => ({
  request_id: crypto.randomUUID(),
  owner_id: 'alice',
  question: 'プ譜をダウンロードしたい',
  language: 'ja',
  choices: [
    { title: '記事を保存', preview: '' },
    { title: 'JSON・画像を保存', preview: 'ダウンロードから形式を選びます' },
  ],
});
const post = (input: unknown = body(), extra = {}) =>
  app.request('/api/v1/feedback/manual-search', { method: 'POST', body: input, ...extra });
const decision = (
  choice = 'n1',
  confidence = 0.9,
  probabilities = { n0: 0.05, n1: 0.9, none: 0.05 },
) => ({
  model: 'clef',
  answers: { section: { type: 'choice', choice, confidence, probabilities } },
  usage: { input_tokens: 10, output_tokens: 0 },
});
const model = (response: unknown = decision()) => {
  const run = vi.fn(async () => response);
  app.env.AI = { run };
  return run;
};
it('selects only a supplied branch, meters the call and never saves questions as feedback', async () => {
  const run = model();
  const input = body();
  expect(await (await post(input)).json()).toEqual({ selection: 1, available: true });
  expect(run).toHaveBeenCalledTimes(1);
  expect((await app.env.DB.prepare('SELECT * FROM usability_feedback').all()).results).toHaveLength(
    0,
  );
  const receipts = (await app.env.DB.prepare('SELECT * FROM manual_search_usage').all()).results;
  expect(receipts).toHaveLength(1);
  expect(JSON.stringify(receipts)).not.toContain(input.question);
  expect(
    (await app.env.DB.prepare("SELECT * FROM ai_attempts WHERE id LIKE 'manual-help-%'").all())
      .results,
  ).toHaveLength(1);
  // Replays consume no second inference, even after the first result was received.
  expect(await (await post(input)).json()).toEqual({ selection: null, available: false });
  expect(run).toHaveBeenCalledTimes(1);
});
it.each([
  decision('n9'),
  decision('n1', 0.3),
  decision('n1', 0.9, { n0: 0.3, n1: 0.4, none: 0.3 }),
  {
    answers: {
      section: {
        type: 'choice',
        choice: 'n1',
        confidence: 0.9,
        probabilities: { n0: 0.05, n1: 0.9 },
      },
    },
  },
])('does not invent a section from malformed or ambiguous decisions: %j', async (result) => {
  model(result);
  expect(await (await post()).json()).toMatchObject({ selection: null });
});
it('falls back to explicit topic choices without AI, and rejects unbounded or unknown input', async () => {
  delete app.env.AI;
  expect(await (await post()).json()).toEqual({ selection: null, available: false });
  for (const input of [
    { ...body(), question: 'x'.repeat(1001) },
    { ...body(), url: 'https://external.test' },
    { ...body(), choices: Array(41).fill({ title: 'a', preview: '' }) },
  ])
    expect((await post(input)).status).toBe(400);
});
it('requires a registered same-origin session and rejects cross-account drafts', async () => {
  const run = model();
  expect((await post(body(), { user: 'unknown' })).status).toBe(401);
  expect((await post(body(), { headers: { Origin: 'https://other.example' } })).status).toBe(403);
  expect((await post(body(), { user: 'bob' })).status).toBe(409);
  expect(run).not.toHaveBeenCalled();
});
it('keeps global inference receipts after account deletion and respects shared daily call limits', async () => {
  const run = model();
  await app.env.DB.batch(
    Array.from({ length: 300 }, () =>
      app.env.DB.prepare('INSERT INTO manual_search_usage(id,created_at) VALUES(?,?)').bind(
        crypto.randomUUID(),
        new Date().toISOString(),
      ),
    ),
  );
  await app.env.DB.prepare("DELETE FROM users WHERE id='alice'").run();
  expect(await (await post({ ...body(), owner_id: 'bob' }, { user: 'bob' })).json()).toEqual({
    selection: null,
    available: false,
  });
  expect(run).not.toHaveBeenCalled();
  await app.env.DB.prepare('DELETE FROM manual_search_usage').run();
  app.env.AI_CALL_DAILY_LIMIT = '1';
  await post({ ...body(), owner_id: 'bob' }, { user: 'bob' });
  await post({ ...body(), owner_id: 'bob' }, { user: 'bob' });
  expect(run).toHaveBeenCalledTimes(1);
});
