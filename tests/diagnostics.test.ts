import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../server/env';
import {
  diagnosticError,
  diagnosticRoute,
  logDiagnosticError,
  observeOperation,
  requestDiagnostics,
  scheduledDiagnostics,
} from '../server/diagnostics';
import { testApp } from './helpers';

afterEach(() => vi.restoreAllMocks());

describe('診断ログの機密値除外', () => {
  it('任意のmessage/name/stack/causeと追加プロパティを出さない', () => {
    const secret = 'private@example.test Bearer abc SELECT bind-secret';
    const error = new Error(secret, { cause: new Error('D1_ERROR: ' + secret) });
    error.name = secret;
    error.stack = `${secret}\n    at ${secret} (https://example.test/token-secret?q=secret:123:45)\n${secret}`;
    Object.assign(error, { sql: secret, params: [secret] });
    const safe = diagnosticError(error);
    expect(safe).toMatchObject({
      name: 'Error',
      kind: 'redacted',
      stack: [{ line: 123, column: 45 }],
      cause: { kind: 'd1_error' },
    });
    expect(JSON.stringify(safe)).not.toMatch(/private|Bearer|SELECT|secret|example/);
    expect(diagnosticError(new Error('Network connection lost.'))).toMatchObject({
      kind: 'network_connection_lost',
    });
    expect(diagnosticError(new Error('D1_ERROR: Network connection lost.'))).toMatchObject({
      kind: 'd1_network_connection_lost',
    });
  });
  it('循環cause、throwするgetter、Error以外でも安全で有限', () => {
    const cycle = new Error('secret');
    cycle.cause = cycle;
    expect(JSON.stringify(diagnosticError(cycle))).toContain('truncated');
    const hostile = Object.defineProperty(new Error(), 'message', {
      get() {
        throw new Error('secret');
      },
    });
    expect(diagnosticError(hostile)).toEqual({ kind: 'unreadable' });
    let reads = 0;
    const changing = new Error('secret');
    // Keep stack independent of Error's lazy name evaluation.
    changing.stack = '';
    Object.defineProperty(changing, 'name', {
      get: () => (++reads === 1 ? 'Error' : 'Bearer private-token'),
    });
    expect(diagnosticError(changing)).toMatchObject({ name: 'Error' });
    expect(reads).toBe(1);
    expect(diagnosticError({ message: 'secret' })).toEqual({ kind: 'non_error' });
  });
  it.each([
    ['/api/config?secret=value#secret', '/api/config'],
    ['/api/v1/stocks/private@example.test/images?token=secret', '/api/v1/stocks/:id/images'],
    ['/api/v1/questions/stocks', '/api/v1/questions/:id'],
    ['/api/v1/memory/history/secret', '/other'],
    ['/unknown-secret', '/other'],
    ['/api/pufu-images/secret-token', '/other'],
  ])('URL %s を固定テンプレートにする', (path, expected) => {
    expect(diagnosticRoute('https://example.test' + path)).toBe(expected);
  });
});

describe('応答・operation・背景処理の相関と失敗保持', () => {
  it('並行リクエストを分離し、入力IDを信用せず、背景処理にIDを引き継ぐ', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = new Hono<AppEnv>();
    app.use('*', requestDiagnostics('worker'));
    const nested = new Hono<AppEnv>();
    nested.use('*', requestDiagnostics('api'));
    const tasks: Promise<unknown>[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const failure = new Error('Network connection lost.');
    nested.get('/api/v1/stocks/:id', (c) => {
      const task = observeOperation('background', 'dispatch_jobs', async () => {
        await gate;
        throw failure;
      });
      // Attach a rejection handler immediately, as waitUntil does in the runtime.
      tasks.push(task.catch((error) => error));
      return c.json({ ok: true }, 202);
    });
    app.all('*', (c) => nested.fetch(c.req.raw, c.env));
    await Promise.all(
      ['first-secret', 'second-secret'].map((id) =>
        app.request(`/api/v1/stocks/${id}?secret=secret`, {
          headers: { 'X-Request-ID': 'forged-secret', 'CF-Ray': 'forged-secret' },
        }),
      ),
    );
    release();
    expect(await Promise.all(tasks)).toEqual([failure, failure]);
    const responses = info.mock.calls.map(([record]) => record);
    expect(responses).toHaveLength(4);
    expect(new Set(responses.map((record) => record.request_id)).size).toBe(2);
    expect(
      responses.every((record) => record.status === 202 && record.route === '/api/v1/stocks/:id'),
    ).toBe(true);
    expect(new Set(errors.mock.calls.map(([record]) => record.request_id))).toEqual(
      new Set(responses.map((record) => record.request_id)),
    );
    expect(JSON.stringify([...info.mock.calls, ...errors.mock.calls])).not.toContain('secret');
  });
  it('D1結果の値を出さずtotal_attemptsを記録し、同じ結果・例外を返す', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = [
      { results: [{ body: 'secret' }], meta: { total_attempts: 2, sql: 'secret' } },
      { meta: { total_attempts: 'secret' } },
    ];
    expect(await observeOperation('d1', 'questions_list', async () => result)).toBe(result);
    expect(info.mock.calls[0][0]).toMatchObject({ total_attempts: [2], phase: 'd1' });
    expect(JSON.stringify(info.mock.calls)).not.toContain('secret');
    const failure = new Error('Network connection lost.');
    await expect(
      scheduledDiagnostics(() =>
        observeOperation('d1', 'dispatch_pending', async () => {
          throw failure;
        }),
      ),
    ).rejects.toBe(failure);
    expect(info.mock.calls).toHaveLength(1);
  });
  it('ログsinkの失敗で応答・例外を変更しない', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('sink');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('sink');
    });
    expect(await observeOperation('background', 'dispatch_jobs', async () => 7)).toBe(7);
    const error = new Error('original');
    logDiagnosticError('api_request', error);
    await expect(
      observeOperation('background', 'dispatch_jobs', async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
  it('実APIでconfig/401/500と主要D1・dispatchを記録し、本文を漏らさない', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = await testApp();
    try {
      expect((await app.request('/api/config?private=secret')).status).toBe(200);
      expect((await app.request('/api/v1/stocks', { headers: { Cookie: '' } })).status).toBe(401);
      expect((await app.request('/api/v1/questions?q=secret')).status).toBe(200);
      expect((await app.request('/api/v1/stocks?q=secret')).status).toBe(200);
      const failure = new Error('D1_ERROR: SELECT private-secret');
      const original = app.env.DB;
      app.env.DB = new Proxy(original, {
        get(target, key) {
          if (key === 'batch') return () => Promise.reject(failure);
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      expect((await app.request('/api/v1/questions')).status).toBe(500);
      const records = info.mock.calls.map(([record]) => record);
      expect(
        records
          .filter((record) => record.event === 'http_response_ready')
          .map((record) => record.status),
      ).toEqual([200, 401, 200, 200, 500]);
      expect(records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ operation: 'questions_list' }),
          expect.objectContaining({ operation: 'stocks_keyword' }),
          expect.objectContaining({ phase: 'background', operation: 'dispatch_jobs' }),
        ]),
      );
      expect(errors.mock.calls).toEqual(
        expect.arrayContaining([
          [
            expect.objectContaining({
              operation: 'questions_list',
              error: expect.objectContaining({ kind: 'd1_error' }),
            }),
          ],
        ]),
      );
      expect(JSON.stringify([...info.mock.calls, ...errors.mock.calls])).not.toMatch(
        /secret|alice|SELECT/,
      );
    } finally {
      await app.dispose();
    }
  });
});
