import { afterEach, expect, it, vi } from 'vitest';
import { launch, type Route } from '@cloudflare/playwright';
import { fetchArticle } from '../server/features/stocks/ingest';
import type { Env } from '../server/env';

vi.mock('@cloudflare/playwright', () => ({ launch: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it.each(['なし', '初回ナビゲーション', '描画待ち中のナビゲーション', '描画後', 'クロール禁止'])(
  'ブラウザー取得のサイズ上限とクロール禁止（失敗条件: %s）',
  async (failure) => {
    const blockedNavigation = failure === 'クロール禁止';
    const lateNavigation = failure === '描画待ち中のナビゲーション';
    const navigationOverflow = failure === '初回ナビゲーション' || lateNavigation;
    const text = '描画後に取得できる記事本文と条件です。'.repeat(20);
    const rendered = `<html><head><title>動的記事</title><link rel="next" href="/story/page/2"></head><body><article><h1>動的記事</h1><p>${text}</p></article></body></html>`;
    const mainFrame = {};
    const missingFrame = () => {
      throw new Error('frame unavailable');
    };
    const requests = [
      ['/large', 'document', () => mainFrame, !navigationOverflow],
      ['/large', 'document', () => ({}), false],
      ['/large', 'script', () => mainFrame, false],
      ['/large', 'document', missingFrame, false],
      ['/small', 'document', missingFrame, true],
      ['/large-text', 'document', () => mainFrame, false],
      ['/render-data', blockedNavigation ? 'document' : 'xhr', () => mainFrame, false],
    ] as const;
    const routeOutcomes: string[][] = [];
    let intercept: (route: Route) => Promise<void>;
    const requestDocuments = async () => {
      for (const [path, resourceType, frame] of requests) {
        const outcome: string[] = [];
        routeOutcomes.push(outcome);
        await intercept({
          request: () => ({
            method: () => 'GET',
            url: () => `https://example.com${path}`,
            resourceType: () => resourceType,
            frame,
          }),
          fulfill: async () => {
            outcome.push('loaded');
          },
          abort: async () => {
            outcome.push('aborted');
          },
        } as unknown as Route);
      }
    };
    const page = {
      goto: async () => {
        if (!lateNavigation) await requestDocuments();
        if (failure === '初回ナビゲーション' || blockedNavigation)
          throw new Error('net::ERR_FAILED');
        return { ok: () => true };
      },
      mainFrame: () => mainFrame,
      locator: () => ({ first: () => ({ waitFor: async () => {} }) }),
      waitForFunction: async () => {
        if (lateNavigation) await requestDocuments();
      },
      content: async () =>
        rendered +
        ' '.repeat(
          3 * 1024 * 1024 +
            Number(failure === '描画後') -
            new TextEncoder().encode(rendered).byteLength,
        ),
    };
    vi.mocked(launch).mockResolvedValue({
      newContext: async () => ({
        route: async (_pattern: string, handler: typeof intercept) => {
          intercept = handler;
        },
        routeWebSocket: async () => {},
        newPage: async () => page,
      }),
      close: async () => {},
    } as unknown as Awaited<ReturnType<typeof launch>>);
    const blockedFetch = vi.fn();
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === 'cloudflare-dns.com')
        return Response.json({
          Status: 0,
          Answer: url.searchParams.get('type') === 'A' ? [{ type: 1, data: '8.8.8.8' }] : [],
        });
      if (url.pathname === '/robots.txt')
        return new Response('User-agent: *\nDisallow: /render-data');
      if (url.pathname === '/render-data') blockedFetch();
      if (url.pathname === '/large-text')
        return new Response(new Uint8Array(2 * 1024 * 1024 + 1), {
          headers: { 'Content-Type': 'text/plain' },
        });
      if (url.pathname === '/large')
        return new Response(new Uint8Array((navigationOverflow ? 3 : 2) * 1024 * 1024 + 1), {
          headers: { 'Content-Type': 'text/html' },
        });
      return new Response(
        url.pathname.endsWith('/2')
          ? `<html><body><article><h1>動的記事</h1><p>後半だけの条件。${text}</p></article></body></html>`
          : '<html><body><article>読込中</article></body></html>',
        { headers: { 'Content-Type': 'text/html' } },
      );
    });
    const result = fetchArticle({ BROWSER: {} } as Env, 'https://example.com/story');
    if (blockedNavigation) {
      await expect(result).rejects.toThrow(/robots\.txt.*禁止/);
    } else if (failure !== 'なし') {
      await expect(result).rejects.toThrow('ページが大きすぎます（上限3MB）。');
    } else {
      const article = await result;
      expect(article.text).toContain('後半だけの条件');
      expect(article.pages).toHaveLength(2);
    }
    expect(routeOutcomes).toEqual(
      requests.map(([, , , shouldLoad]) => [shouldLoad ? 'loaded' : 'aborted']),
    );
    expect(blockedFetch).not.toHaveBeenCalled();
  },
);
