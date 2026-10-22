import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchArticle } from '../server/ingest';
import type { Env } from '../server/env';
import { japanesePdfFixture, japanesePdfText, pdfArticleText, pdfFixture } from './pdf-fixture';
import { readFile } from 'node:fs/promises';

describe('公開記事の取得', () => {
  afterEach(() => vi.unstubAllGlobals());
  const env = {} as Env;
  const articleText = '記事の保存と要約を分離し、失敗した処理を再試行する方法を検証します。'.repeat(
    12,
  );
  function mockNetwork(response: (url: URL, init?: RequestInit) => Response) {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
        return response(url, init);
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

  it('YouTubeへのリダイレクト先には接続しない', async () => {
    const requests = mockNetwork(
      () =>
        new Response(null, { status: 302, headers: { Location: 'https://youtu.be/dQw4w9WgXcQ' } }),
    );
    await expect(fetchArticle(env, 'https://example.com/start')).rejects.toThrow(
      /YouTube.*記録できません/,
    );
    expect(requests).toEqual(['https://example.com/start']);
  });

  it.each(['youtube.com.example.com', 'notyoutube.com'])(
    'YouTubeに似た別ドメインの公開記事は取得する: %s',
    async (host) => {
      mockNetwork(() => new Response(articleText, { headers: { 'Content-Type': 'text/plain' } }));
      expect(await fetchArticle(env, `https://${host}/story`)).toEqual({
        title: host,
        text: articleText,
      });
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

  it.each(['application/pdf;charset=UTF-8', 'APPLICATION/PDF', 'application/octet-stream'])(
    'PDFの複数ページと日本語のメタデータタイトルを取得する: %s',
    async (contentType) => {
      mockNetwork(
        () =>
          new Response(pdfFixture([pdfArticleText, 'The second page.'], '記事のPDF'), {
            headers: { 'Content-Type': contentType },
          }),
      );
      const article = await fetchArticle(env, 'https://example.com/_pdf/-char/ja');
      expect(article.title).toBe('記事のPDF');
      expect(article.text.replace(/\s+/g, ' ')).toContain(pdfArticleText.trim());
      expect(article.text).toContain('The second page.');
    },
  );

  it('タイトル情報のないPDFは本文の先頭をタイトルにする', async () => {
    mockNetwork(
      () =>
        new Response(pdfFixture([pdfArticleText]), {
          headers: { 'Content-Type': 'application/pdf' },
        }),
    );
    const article = await fetchArticle(env, 'https://example.com/paper.pdf');
    expect(article.title).toContain('Saving an article');
    expect(article.title.length).toBeLessThanOrEqual(300);
  });

  it('PDFを受け入れる要求を送り、形式を指定して配信するサーバーから取得する', async () => {
    mockNetwork((_url, init) => {
      const accept = new Headers(init?.headers).get('Accept') ?? '';
      return accept.includes('application/pdf')
        ? new Response(pdfFixture([pdfArticleText]), {
            headers: { 'Content-Type': 'application/pdf' },
          })
        : new Response(null, { status: 406 });
    });
    expect((await fetchArticle(env, 'https://example.com/paper')).text).toContain(
      'Saving an article',
    );
  });

  it('日本語の組み込み文字対応表を同梱資源から読み、外部通信なしで本文を取得する', async () => {
    const requests = mockNetwork(
      () =>
        new Response(japanesePdfFixture(), {
          headers: { 'Content-Type': 'application/pdf' },
        }),
    );
    const assets = {
      async fetch(input: RequestInfo | URL) {
        const name = new URL(String(input)).pathname.split('/').pop()!;
        const data = await readFile(
          new URL(`../node_modules/pdfjs-dist/cmaps/${name}`, import.meta.url),
        );
        return new Response(data);
      },
    } as Fetcher;
    const article = await fetchArticle(
      { ...env, ASSETS: assets },
      'https://example.com/japanese.pdf',
    );
    expect(article.text).toContain(japanesePdfText);
    expect(article.text.length).toBeGreaterThan(200);
    expect(requests).toEqual(['https://example.com/japanese.pdf']);
  });

  it.each([true, false])(
    '10MBを超えるPDFを拒否する（Content-Lengthあり: %s）',
    async (declared) => {
      mockNetwork(
        () =>
          new Response(declared ? 'PDF' : new Uint8Array(10 * 1024 * 1024 + 1), {
            headers: {
              'Content-Type': 'application/pdf',
              'Content-Length': declared ? String(10 * 1024 * 1024 + 1) : '1',
            },
          }),
      );
      await expect(fetchArticle(env, 'https://example.com/large.pdf')).rejects.toThrow(/PDF.*10MB/);
    },
  );

  it.each([
    ['壊れたPDF', new TextEncoder().encode('%PDF-1.7\ninvalid'), /PDF.*読み取れません/],
    ['文字情報のないPDF', pdfFixture(['']), /PDF.*文字情報.*本文を補完/],
    [
      '100ページを超えるPDF',
      pdfFixture(Array.from({ length: 101 }, () => 'page')),
      /PDF.*100ページ/,
    ],
    ['12万文字を超えるPDF', pdfFixture(['long text '.repeat(12001)]), /本文.*12万文字/],
  ])('%sを理由付きで拒否する', async (_name, pdf, error) => {
    mockNetwork(
      () =>
        new Response(pdf as Uint8Array<ArrayBuffer>, {
          headers: { 'Content-Type': 'application/pdf' },
        }),
    );
    await expect(fetchArticle(env, 'https://example.com/paper.pdf')).rejects.toThrow(
      error as RegExp,
    );
  });
});
