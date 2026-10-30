import { describe, expect, it } from 'vitest';
import worker from '../server/index';
import type { Env } from '../server/env';

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const env = {
  APP_URL: 'https://pufu.example',
  ASSETS: {
    async fetch(request: Request) {
      const url = new URL(request.url);
      const page = url.pathname.startsWith('/privacy') ? 'プライバシーポリシー' : '利用規約';
      return new Response(
        request.method === 'HEAD' ? null : `<html lang="ja"><h1>${page}</h1></html>`,
        {
          headers: { 'Content-Type': 'text/html; charset=utf-8', Vary: 'Accept-Encoding' },
        },
      );
    },
  },
} as unknown as Env;
function read(path: string, language?: string, method = 'GET') {
  return worker.fetch(
    new Request(`https://pufu.example${path}`, {
      method,
      headers: language === undefined ? {} : { 'Accept-Language': language },
    }),
    env,
    ctx,
  );
}

describe('通常URLでの法務ページのブラウザー言語', () => {
  it.each([
    ['/privacy', 'en-US,en;q=0.9', '/en/privacy'],
    ['/terms/', 'fr-FR,ja;q=0.8', '/en/terms'],
    ['/privacy', 'ja;q=0.3,en;q=0.9', '/en/privacy'],
    ['/terms', undefined, '/en/terms'],
    ['/privacy?lang=invalid&next=https://evil.example', 'en', '/en/privacy'],
  ])('日本語以外の主言語は英語版へ一時転送する: %s %s', async (path, language, location) => {
    const response = await read(path, language);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(location);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Vary')).toContain('Accept-Language');
  });

  it.each(['ja-JP,en;q=0.9', 'en;q=0.2,ja;q=0.8', 'JA'])(
    '日本語の主言語では認証なしで日本語本文を返す: %s',
    async (language) => {
      // No DB/auth bindings exist: documentation must not depend on an account.
      const response = await read('/privacy', language);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/html');
      expect(await response.text()).toContain('プライバシーポリシー');
      expect(response.headers.get('Vary')).toContain('Accept-Language');
      expect(response.headers.get('Vary')).toContain('Accept-Encoding');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    },
  );

  it('英語ブラウザーから明示した日本語原文を再転送せず、HEADでも本文を返さない', async () => {
    const original = await read('/terms?lang=ja', 'en-US');
    expect(original.status).toBe(200);
    expect(original.headers.get('Location')).toBeNull();
    expect(await original.text()).toContain('利用規約');
    const head = await read('/terms/?lang=ja', 'en-US', 'HEAD');
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect((await read('/privacy?lang=en', 'ja-JP', 'HEAD')).headers.get('Location')).toBe(
      '/en/privacy',
    );
  });
});
