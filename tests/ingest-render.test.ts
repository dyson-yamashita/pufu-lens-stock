import { afterEach, expect, it, vi } from 'vitest';
import { launch } from '@cloudflare/playwright';
import { fetchArticle } from '../server/ingest';
import type { Env } from '../server/env';

vi.mock('@cloudflare/playwright', () => ({ launch: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it('ブラウザーで得たHTMLからも次ページを検出する', async () => {
  const text = '描画後に取得できる記事本文と条件です。'.repeat(20);
  const rendered = `<html><head><title>動的記事</title><link rel="next" href="/story/page/2"></head><body><article><h1>動的記事</h1><p>${text}</p></article></body></html>`;
  const page = {
    goto: async () => ({ ok: () => true }),
    locator: () => ({ first: () => ({ waitFor: async () => {} }) }),
    waitForFunction: async () => {},
    content: async () => rendered,
  };
  vi.mocked(launch).mockResolvedValue({
    newContext: async () => ({
      route: async () => {},
      routeWebSocket: async () => {},
      newPage: async () => page,
    }),
    close: async () => {},
  } as unknown as Awaited<ReturnType<typeof launch>>);
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === 'cloudflare-dns.com')
      return Response.json({
        Status: 0,
        Answer: url.searchParams.get('type') === 'A' ? [{ type: 1, data: '8.8.8.8' }] : [],
      });
    return new Response(
      url.pathname.endsWith('/2')
        ? `<html><body><article><h1>動的記事</h1><p>後半だけの条件。${text}</p></article></body></html>`
        : '<html><body><article>読込中</article></body></html>',
      { headers: { 'Content-Type': 'text/html' } },
    );
  });
  const article = await fetchArticle({ BROWSER: {} } as Env, 'https://example.com/story');
  expect(article.text.includes('後半だけの条件')).toBe(true);
  expect(article.pages).toHaveLength(2);
});
