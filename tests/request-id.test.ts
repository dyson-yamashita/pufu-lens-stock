import { afterEach, expect, test, vi } from 'vitest';
import { userQuestionSchema } from '../shared/domain';
import { createRequestId } from '../src/api';

afterEach(() => vi.unstubAllGlobals());

test('HTTPのLAN接続でもAPIに送信できる一意なリクエストIDを生成する', () => {
  vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
  const ids = Array.from({ length: 100 }, createRequestId);
  expect(new Set(ids).size).toBe(ids.length);
  for (const request_id of ids) {
    expect(
      userQuestionSchema.safeParse({ stock_id: 'stock-id', text: '問い', request_id }).success,
    ).toBe(true);
  }
});
