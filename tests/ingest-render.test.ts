import { afterEach, expect, it, vi } from 'vitest';
import { launch, type Route } from '@cloudflare/playwright';
import { fetchArticle } from '../server/features/stocks/ingest';
import type { Env } from '../server/env';

vi.mock('@cloudflare/playwright', () => ({ launch: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
const renderingFailureScenarios = [
  'なし',
  '初回ナビゲーション',
  '描画待ち中のナビゲーション',
  '描画後',
  'クロール禁止',
  '本文不足',
] as const;
it.each(renderingFailureScenarios)(
  'ブラウザー取得のサイズ上限・クロール禁止・本文不足（失敗条件: %s）',
  async (failure) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const blockedNavigation = failure === 'クロール禁止';
    const lateNavigation = failure === '描画待ち中のナビゲーション';
    const navigationOverflow = failure === '初回ナビゲーション' || lateNavigation;
    const shortText = 'private-rendered-text';
    const text = '描画後に取得できる記事本文と条件です。'.repeat(20);
    const rendered =
      failure === '本文不足'
        ? `<html><head><title>private-rendered-title</title></head><body><article>${shortText}</article></body></html>`
        : `<html><head><title>動的記事</title><link rel="next" href="/story/page/2"></head><body><article><h1>動的記事</h1><p>${text}</p></article></body></html>`;
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
      ...(failure === '本文不足'
        ? [['https://unavailable.example.com/data', 'xhr', () => mainFrame, false] as const]
        : []),
    ] as const;
    const routeOutcomes: string[][] = [];
    let intercept: (route: Route) => Promise<void>;
    let cleanupRequest: Promise<void> | undefined;
    let robotsRequested!: () => void;
    const waitingForRobots = new Promise<void>((resolve) => {
      robotsRequested = resolve;
    });
    const routeRequest = (
      path: string,
      resourceType: string,
      frame: () => object,
      outcome: string[] = [],
    ) =>
      intercept({
        request: () => ({
          method: () => 'GET',
          url: () => new URL(path, 'https://example.com').href,
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
    const requestDocuments = async () => {
      for (const [path, resourceType, frame] of requests) {
        const outcome: string[] = [];
        routeOutcomes.push(outcome);
        await routeRequest(path, resourceType, frame, outcome);
      }
    };
    const page = {
      goto: async () => {
        if (!lateNavigation) await requestDocuments();
        if (failure === '初回ナビゲーション' || blockedNavigation)
          throw new Error('net::ERR_FAILED');
        return { ok: () => true, status: () => 200 };
      },
      mainFrame: () => mainFrame,
      locator: () => ({ first: () => ({ waitFor: async () => {} }) }),
      waitForFunction: async () => {
        if (lateNavigation) await requestDocuments();
      },
      content: async () => {
        if (failure === '本文不足') {
          cleanupRequest = routeRequest('https://cleanup.example.com/data', 'xhr', () => mainFrame);
          await waitingForRobots;
        }
        return (
          rendered +
          ' '.repeat(
            3 * 1024 * 1024 +
              Number(failure === '描画後') -
              new TextEncoder().encode(rendered).byteLength,
          )
        );
      },
    };
    vi.mocked(launch).mockResolvedValue({
      newContext: async () => ({
        route: async (_pattern: string, handler: typeof intercept) => {
          intercept = handler;
        },
        routeWebSocket: async () => {},
        newPage: async () => page,
      }),
      close: async () => {
        await cleanupRequest;
      },
    } as unknown as Awaited<ReturnType<typeof launch>>);
    const blockedFetch = vi.fn();
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === 'cloudflare-dns.com')
        return Response.json({
          Status: 0,
          Answer: url.searchParams.get('type') === 'A' ? [{ type: 1, data: '8.8.8.8' }] : [],
        });
      if (url.pathname === '/robots.txt') {
        if (url.hostname === 'unavailable.example.com') return new Response(null, { status: 503 });
        if (url.hostname === 'cleanup.example.com') {
          const signal = init?.signal;
          robotsRequested();
          return new Promise<Response>((_, reject) => {
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        }
        return new Response('User-agent: *\nDisallow: /render-data');
      }
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
    const url = 'https://example.com/story' + (failure === '本文不足' ? '?token=private-url' : '');
    const result = fetchArticle({ BROWSER: {} } as Env, url);
    if (blockedNavigation) {
      await expect(result).rejects.toThrow(/robots\.txt.*禁止/);
      expect(errors).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          event: 'article_fetch_failed',
          stage: 'render',
          reason: 'robots_disallowed',
          http_status: 200,
          initial_text_length: 3,
        }),
      );
    } else if (failure === '本文不足') {
      await expect(result).rejects.toThrow(/記事本文を十分に取得できませんでした/);
      expect(errors).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          event: 'article_fetch_failed',
          stage: 'extract_rendered_html',
          reason: 'insufficient_text',
          http_status: 200,
          browser_http_status: 200,
          content_type: 'html',
          initial_text_length: 3,
          rendered_text_length: shortText.length,
          browser_robots_disallowed: 1,
          browser_robots_unavailable: 1,
        }),
      );
      expect(JSON.stringify(errors.mock.calls)).not.toMatch(/private-|example\.com/);
    } else if (failure !== 'なし') {
      await expect(result).rejects.toThrow('ページが大きすぎます（上限3MB）。');
      expect(errors).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ reason: 'body_too_large', browser_http_status: 200 }),
      );
    } else {
      const article = await result;
      expect(article.text).toContain('後半だけの条件');
      expect(article.pages).toHaveLength(2);
      expect(errors).not.toHaveBeenCalled();
    }
    expect(routeOutcomes).toEqual(
      requests.map(([, , , shouldLoad]) => [shouldLoad ? 'loaded' : 'aborted']),
    );
    expect(blockedFetch).not.toHaveBeenCalled();
  },
);
