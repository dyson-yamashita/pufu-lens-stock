import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../server/api';
import { scheduledMaintenance } from '../server/jobs';
import { aiStep, AiLimitError } from '../server/usage';
import { mockStep, testApp } from './helpers';
import type { Job } from '../server/env';
import type { User } from '../shared/domain';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1cAAAAASUVORK5CYII=',
  'base64',
);
let app: Awaited<ReturnType<typeof testApp>>;
const run = vi.fn();
beforeEach(async () => {
  app = await testApp();
  run.mockReset().mockResolvedValue({
    choices: [
      { finish_reason: 'stop', message: { role: 'assistant', content: ' プロジェクト\nX API ' } },
    ],
  });
  app.env.AI = { run };
});
afterEach(async () => app.dispose());
const read = (id = crypto.randomUUID(), image = png, headers: Record<string, string> = {}) =>
  createApp().request(
    `${app.env.APP_URL}/api/v1/ocr`,
    {
      method: 'POST',
      headers: {
        Cookie: 'stock_session=alice-session',
        Origin: app.env.APP_URL,
        'Content-Type': 'image/png',
        'Idempotency-Key': id,
        ...headers,
      },
      body: image,
    },
    app.env,
    app.ctx,
  );
const count = async (table: string) =>
  (await app.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

it('画像対応モデルへ画像を送り、抽出本文とモデルを返し、実呼び出しを永続記録する', async () => {
  const response = await read();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    text: 'プロジェクト\nX API',
    model: '@cf/qwen/qwen3.8-27b',
  });
  expect(run).toHaveBeenCalledWith(
    '@cf/qwen/qwen3.8-27b',
    expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.arrayContaining([
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${png.toString('base64')}` },
            },
          ]),
        }),
      ]),
      max_completion_tokens: 8192,
      chat_template_kwargs: { enable_thinking: false },
    }),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(await count('ai_attempts')).toBe(1);
  expect(await app.env.DB.prepare('SELECT kind FROM ai_operations').first()).toEqual({
    kind: 'ocr',
  });
});

it('OCR専用モデルの設定を要約用モデルから独立して適用する', async () => {
  app.env.OCR_MODEL = '@cf/test/vision';
  expect(((await (await read()).json()) as { model: string }).model).toBe('@cf/test/vision');
  expect(app.env.AI_MODEL).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
});

it('形式・内容・バイト数・画素数・UUIDをAI呼び出し前に検証する', async () => {
  const huge = Buffer.from(png);
  huge.writeUInt32BE(10000, 16);
  huge.writeUInt32BE(10000, 20);
  const cases: { image: Buffer; headers: Record<string, string>; status: number }[] = [
    { image: png, headers: { 'Content-Type': 'image/jpeg' }, status: 400 },
    { image: Buffer.from('not an image'), headers: {}, status: 400 },
    { image: png, headers: { 'Content-Type': 'image/svg+xml' }, status: 400 },
    { image: Buffer.alloc(10 * 1024 * 1024 + 1), headers: {}, status: 413 },
    { image: huge, headers: {}, status: 413 },
    { image: png, headers: { 'Idempotency-Key': 'invalid' }, status: 400 },
  ];
  for (const value of cases)
    expect((await read(crypto.randomUUID(), value.image, value.headers)).status).toBe(value.status);
  expect(run).not.toHaveBeenCalled();
  expect(await count('ai_attempts')).toBe(0);
});

it('未認証と異なるOriginからの読み取りを拒否する', async () => {
  expect((await read(crypto.randomUUID(), png, { Cookie: '' })).status).toBe(401);
  expect((await read(crypto.randomUUID(), png, { Origin: 'https://other.example' })).status).toBe(
    403,
  );
  expect(run).not.toHaveBeenCalled();
});

it('ユーザーごとの24時間上限を適用し、再送を再計上せず、別ユーザーには枠を残す', async () => {
  app.env.AI_OCR_DAILY_LIMIT = '2';
  const first = crypto.randomUUID();
  expect((await read(first)).status).toBe(200);
  expect((await read()).status).toBe(200);
  expect((await read(first)).status).toBe(200);
  const limited = await read();
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(80000);
  expect(((await limited.json()) as { retry_at: string }).retry_at).toBeTruthy();
  expect(
    (await read(crypto.randomUUID(), png, { Cookie: 'stock_session=bob-session' })).status,
  ).toBe(200);
  await app.env.DB.prepare(
    "UPDATE ai_operations SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days')",
  ).run();
  expect((await read()).status).toBe(200);
  expect(run).toHaveBeenCalledTimes(4);
});

it('同じUUIDの並行再送は二重実行せず、完了結果を再利用し、画像の差し替えを拒否する', async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  run.mockImplementation(async () => {
    entered();
    await blocked;
    return {
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '本文' } }],
    };
  });
  app.env.AI_CONCURRENT_CALLS = '1';
  const id = crypto.randomUUID();
  const first = read(id);
  await started;
  try {
    expect((await read(id)).status).toBe(409);
    expect((await read()).status).toBe(429);
  } finally {
    release();
  }
  expect((await first).status).toBe(200);
  expect((await read(id)).status).toBe(200);
  const changed = Buffer.from(png);
  changed[changed.length - 1] ^= 1;
  expect((await read(id, changed)).status).toBe(409);
  expect(run).toHaveBeenCalledOnce();
  expect(await count('ai_operations')).toBe(1);
  expect(await count('ai_attempts')).toBe(1);
});

it('OCRの実呼び出しが既存WorkflowのAI日次上限にも計上される', async () => {
  app.env.AI_CALL_DAILY_LIMIT = '1';
  expect((await read()).status).toBe(200);
  const job: Job = {
    id: 'summary',
    user_id: 'alice',
    kind: 'article',
    target_id: 'example',
    revision: 1,
    status: 'pending',
  };
  await expect(
    aiStep(app.env, job, mockStep(), 'summary', async () => ({})),
  ).rejects.toBeInstanceOf(AiLimitError);
  expect((await read()).status).toBe(429);
  expect(run).toHaveBeenCalledOnce();
});

it('既存AIの同時実行枠が埋まっているとOCRも推論前に429を返す', async () => {
  app.env.AI_CONCURRENT_CALLS = '1';
  await app.env.DB.prepare(
    "INSERT INTO ai_calls (id,job_id,user_id,status) VALUES ('other','other','alice','running')",
  ).run();
  expect((await read()).status).toBe(429);
  expect(run).not.toHaveBeenCalled();
  expect(await count('ai_operations')).toBe(0);
});

it('失敗も上限に計上し、同じ要求を自動再推論せず、生のエラーを公開しない', async () => {
  app.env.AI_OCR_DAILY_LIMIT = '1';
  run.mockRejectedValue(new Error('private provider error'));
  const id = crypto.randomUUID();
  const response = await read(id);
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain('private provider error');
  expect((await read(id)).status).toBe(502);
  expect((await read()).status).toBe(429);
  expect(run).toHaveBeenCalledOnce();
  expect(await count('ai_attempts')).toBe(1);
});

it.each([
  { choices: [{ finish_reason: 'length', message: { content: '途中の本文' } }] },
  { response: '   ' },
  { response: 'あ'.repeat(20001) },
  { unexpected: '不正な形式' },
])('不完全・空・長すぎる出力を本文として返さない: %j', async (output) => {
  run.mockResolvedValue(output);
  expect((await read()).status).toBe(502);
});

it('Workers AIが未設定の場合は利用枠を消費しない', async () => {
  delete app.env.AI;
  expect((await read()).status).toBe(503);
  expect(await count('ai_operations')).toBe(0);
});

it('中断したOCRをCronで失敗へ回復し、同じIDの再推論はしない', async () => {
  await read();
  await app.env.DB.prepare(
    "UPDATE ai_calls SET status='running',result_json=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-11 minutes')",
  ).run();
  await scheduledMaintenance(app.env);
  expect(await app.env.DB.prepare('SELECT status,retry_blocked FROM ai_calls').first()).toEqual({
    status: 'failed',
    retry_blocked: 1,
  });
});

it('共有用BearerトークンとMCP認可には画像OCRの権限を付与しない', async () => {
  const issued = await app.request('/api/v1/tokens', {
    method: 'POST',
    body: { name: 'OCR test' },
  });
  const { token } = (await issued.json()) as { token: string };
  expect(
    (await read(crypto.randomUUID(), png, { Cookie: '', Authorization: `Bearer ${token}` })).status,
  ).toBe(403);
  const user = await app.env.DB.prepare("SELECT * FROM users WHERE id='alice'").first<User>();
  const response = await createApp({ user: user!, kind: 'mcp', tokenProjectId: null }).request(
    `${app.env.APP_URL}/api/v1/ocr`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', 'Idempotency-Key': crypto.randomUUID() },
      body: png,
    },
    app.env,
    app.ctx,
  );
  expect(response.status).toBe(403);
  expect(run).not.toHaveBeenCalled();
});

it('日次枠が残り1回の並行要求でも1件だけを受け付ける', async () => {
  app.env.AI_OCR_DAILY_LIMIT = '1';
  const responses = await Promise.all([read(), read()]);
  expect(responses.map((response) => response.status).sort()).toEqual([200, 429]);
  expect(run).toHaveBeenCalledOnce();
  expect(await count('ai_operations')).toBe(1);
  expect(await count('ai_attempts')).toBe(1);
});

it('不正JPEGのヘッダー検証で入力全体を繰り返しコピーしない', async () => {
  const malformed = Buffer.alloc(600000);
  malformed.set([0xff, 0xd8, 0xff, 0xe0]);
  const started = performance.now();
  const response = await read(crypto.randomUUID(), malformed, { 'Content-Type': 'image/jpeg' });
  expect(response.status).toBe(400);
  expect(performance.now() - started).toBeLessThan(1500);
  expect(run).not.toHaveBeenCalled();
});

it('PNGに偽装した未対応形式を重い画像解析に渡さず拒否する', async () => {
  const disguised = Buffer.from('P1\n' + '#\n'.repeat(300000) + '1 1\n0\n');
  const started = performance.now();
  const response = await read(crypto.randomUUID(), disguised);
  expect(response.status).toBe(400);
  expect(performance.now() - started).toBeLessThan(1500);
  expect(run).not.toHaveBeenCalled();
});

it('WebPの実データを受け付け、正しい画像形式でモデルへ渡す', async () => {
  const image = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
  expect((await read(crypto.randomUUID(), image, { 'Content-Type': 'image/webp' })).status).toBe(
    200,
  );
  expect(run.mock.calls[0][1].messages[1].content[0].image_url.url).toBe(
    `data:image/webp;base64,${image.toString('base64')}`,
  );
});
