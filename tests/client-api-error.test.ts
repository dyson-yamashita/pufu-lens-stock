import { afterEach, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/api';
import { t } from '../src/i18n';

afterEach(() => vi.unstubAllGlobals());

it.each([
  { status: 503, body: '<html>Service unavailable</html>' },
  { status: 504, body: '' },
  { status: 401, body: 'null' },
])('keeps HTTP status $status even without a JSON error object', async ({ status, body }) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status })),
  );
  const error = await api('/api/v1/pufus/test').catch((error: unknown) => error);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status, message: t('ui.api.the_operation_failed') });
});

it('preserves a structured API error message and status', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: '保存できません。' }, { status: 409 })),
  );
  await expect(api('/api/v1/pufus/test')).rejects.toMatchObject({
    status: 409,
    message: '保存できません。',
  });
});

it('still rejects malformed JSON from a successful response', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('<html>Unexpected</html>')),
  );
  await expect(api('/api/v1/pufus/test')).rejects.toBeInstanceOf(SyntaxError);
});
