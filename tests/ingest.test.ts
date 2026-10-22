import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fetchArticle } from '../server/ingest';
import type { Env } from '../server/env';
import { japanesePdfFixture, japanesePdfText, pdfArticleText, pdfFixture } from './pdf-fixture';
import { createPdfWorker } from './pdf-worker-helper';

describe('公開記事の取得', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const env = {} as Env;
  let pdfWorker: Awaited<ReturnType<typeof createPdfWorker>>;
  beforeAll(async () => {
    pdfWorker = await createPdfWorker();
    env.PDF_PARSER = pdfWorker.parser;
  });
  afterAll(async () => pdfWorker?.dispose());
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

  it('PDFの解析結果を専用Workerから受け取り、本文バイト列だけを渡す', async () => {
    const pdf = pdfFixture([pdfArticleText], '元のPDF');
    mockNetwork(() => new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } }));
    const calls: Request[] = [];
    const parser = {
      async fetch(request: Request) {
        calls.push(request);
        return Response.json({ title: '隔離先のタイトル', text: articleText });
      },
    } as unknown as Fetcher;
    expect(
      await fetchArticle({ ...env, PDF_PARSER: parser } as Env, 'https://example.com/paper.pdf'),
    ).toEqual({
      title: '隔離先のタイトル',
      text: articleText,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://example.com/paper.pdf');
    expect(calls[0].headers.get('Cookie')).toBeNull();
    expect(calls[0].headers.get('Authorization')).toBeNull();
    expect(new Uint8Array(await calls[0].arrayBuffer())).toEqual(pdf);
  });

  it.each(['未設定', '資源超過', '異常応答'])(
    'PDF専用Workerが%sなら本体で解析せず、本文補完を案内する',
    async (failure) => {
      mockNetwork(
        () =>
          new Response(pdfFixture([pdfArticleText]), {
            headers: { 'Content-Type': 'application/pdf' },
          }),
      );
      const parser =
        failure === '未設定'
          ? undefined
          : ({
              async fetch() {
                if (failure === '資源超過') throw new Error('Worker exceeded memory limit');
                return new Response('Worker exceeded resource limits', { status: 500 });
              },
            } as unknown as Fetcher);
      await expect(
        fetchArticle({ ...env, PDF_PARSER: parser } as Env, 'https://example.com/paper.pdf'),
      ).rejects.toThrow(/PDF.*本文を補完/);
    },
  );

  it('PDF専用Workerが応答しない場合は待機を打ち切る', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mockNetwork(
      () =>
        new Response(pdfFixture([pdfArticleText]), {
          headers: { 'Content-Type': 'application/pdf' },
        }),
    );
    const parser = { fetch: () => new Promise<Response>(() => {}) } as unknown as Fetcher;
    const result = expect(
      fetchArticle({ ...env, PDF_PARSER: parser }, 'https://example.com/paper.pdf'),
    ).rejects.toThrow(/PDF.*本文を補完/);
    await vi.advanceTimersByTimeAsync(20000);
    await result;
  });

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
    const article = await fetchArticle(env, 'https://example.com/japanese.pdf');
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
