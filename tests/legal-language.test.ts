import { describe, expect, it } from 'vitest';
import worker from '../server/index';
import type { Env } from '../server/env';

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const env = {
  APP_URL: 'https://pufu.example',
  ASSETS: {
    async fetch(request: Request) {
      const url = new URL(request.url);
      const english = url.pathname.startsWith('/en/');
      const page = url.pathname.includes('privacy')
        ? english
          ? 'Privacy Policy'
          : 'プライバシーポリシー'
        : english
          ? 'Terms of Service'
          : '利用規約';
      return new Response(
        request.method === 'HEAD'
          ? null
          : `<html lang="${english ? 'en' : 'ja'}"><h1>${page}</h1></html>`,
        {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
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

describe('法務ページは言語URL固定でAccept-Language転送しない', () => {
  it.each([
    ['/privacy', 'en-US,en;q=0.9', 'プライバシーポリシー', 'ja'],
    ['/terms/', 'fr-FR,ja;q=0.8', '利用規約', 'ja'],
    ['/privacy', 'ja;q=0.3,en;q=0.9', 'プライバシーポリシー', 'ja'],
    ['/en/privacy', 'ja-JP', 'Privacy Policy', 'en'],
    ['/en/terms/', undefined, 'Terms of Service', 'en'],
  ])('%s stays on the URL language despite %s', async (path, language, heading, lang) => {
    const response = await read(path, language);
    expect(response.status).toBe(200);
    expect(response.headers.get('Location')).toBeNull();
    expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=');
    expect(response.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.text();
    expect(body).toContain(heading);
    expect(body).toContain(`lang="${lang}"`);
  });

  it('HEAD keeps security headers and omits a body', async () => {
    const head = await read('/privacy', 'en-US', 'HEAD');
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(head.headers.get('Strict-Transport-Security')).toContain('max-age=');
    expect(head.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
  });
});
