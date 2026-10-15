import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchArticle } from '../server/ingest';
import type { Env } from '../server/env';

describe('公開記事の取得', () => {
  afterEach(() => vi.unstubAllGlobals());
  const env = {} as Env;
  const articleText = '記事の保存と要約を分離し、失敗した処理を再試行する方法を検証します。'.repeat(
    12,
  );
  function mockNetwork(response: (url: URL) => Response) {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.hostname === 'cloudflare-dns.com')
          return new Response(
            JSON.stringify({
              Status: 0,
              Answer:
                url.searchParams.get('type') === 'A'
                  ? [
                      {
                        type: 1,
                        data:
                          url.searchParams.get('name') === 'internal.example.com'
                            ? '10.0.0.1'
                            : '8.8.8.8',
                      },
                    ]
                  : [],
            }),
          );
        requests.push(url.href);
        return response(url);
      }),
    );
    return requests;
  }

  it('相対URLへのリダイレクトをたどり、移動先の記事タイトルと本文を取得する', async () => {
    const requests = mockNetwork((url) =>
      url.pathname === '/folder/start'
        ? new Response(null, { status: 302, headers: { Location: '../article' } })
        : new Response(
            `<html><head><title>記事の取得テスト</title></head><body><article><h1>記事の取得テスト</h1><p>${articleText}</p></article></body></html>`,
            { headers: { 'Content-Type': 'text/html' } },
          ),
    );
    const article = await fetchArticle(env, 'https://example.com/folder/start');
    expect(article.title).toBe('記事の取得テスト');
    expect(article.text).toContain(articleText);
    expect(requests).toEqual(['https://example.com/folder/start', 'https://example.com/article']);
  });

  it.each(['http://127.0.0.1/private', 'https://internal.example.com/private'])(
    'リダイレクト先が内部ネットワークなら接続せず拒否する: %s',
    async (destination) => {
      const requests = mockNetwork((url) =>
        url.hostname === 'example.com'
          ? new Response(null, { status: 302, headers: { Location: destination } })
          : new Response(articleText, { headers: { 'Content-Type': 'text/plain' } }),
      );
      await expect(fetchArticle(env, 'https://example.com/start')).rejects.toThrow();
      expect(requests).toEqual(['https://example.com/start']);
    },
  );

  it.each([true, false])(
    '2MBを超えるページを拒否する（Content-Lengthあり: %s）',
    async (declared) => {
      const size = 2 * 1024 * 1024 + 1;
      mockNetwork(
        () =>
          new Response(declared ? '本文' : new Uint8Array(size), {
            headers: {
              'Content-Type': 'text/plain',
              ...(declared ? { 'Content-Length': String(size) } : {}),
            },
          }),
      );
      await expect(fetchArticle(env, 'https://example.com/large')).rejects.toThrow(
        'ページが大きすぎます',
      );
    },
  );
});
