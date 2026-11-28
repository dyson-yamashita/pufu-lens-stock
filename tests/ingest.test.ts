import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fetchArticle } from '../server/features/stocks/ingest';
import { pdfInsufficientTextMessage } from '../server/features/stocks/pdf/errors';
import type { Env } from '../server/env';
import { japanesePdfFixture, japanesePdfText, pdfArticleText, pdfFixture } from './pdf-fixture';
import { createPdfWorker } from './pdf-worker-helper';

describe('公開記事の取得', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
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
  function mockNetwork(
    response: (url: URL, init?: RequestInit) => Response,
    robots: (url: URL, init?: RequestInit) => Response = () => new Response(null, { status: 404 }),
  ) {
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
        if (url.pathname === '/robots.txt') return robots(url, init);
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

  const deckUrl = 'https://speakerdeck.com/pufu-test/storage-slides?slide=22';
  const slideFiles = 'https://files.speakerdeck.com/presentations/0123456789abcdef0123456789abcdef';
  const deckPdf = `${slideFiles}/storage-slides.pdf`;
  const otherDeckPdf =
    'https://files.speakerdeck.com/presentations/ffffffffffffffffffffffffffffffff/related.pdf';
  const slideText = 'スライドの本文を取得し、テキストの並び順と各スライドの説明を確認します。';
  function deckPage(transcript = '', download = '') {
    return new Response(
      `<html><head><title>テスト資料 - Speaker Deck</title><link rel="alternate" type="application/json+oembed" href="/oembed.json?url=deck"><meta property="og:image" content="${slideFiles}/slide_0.jpg"></head><body><main><h1>テスト資料</h1>
       <div><h2>Have presentations of your own?</h2><p>${'Annual Pro sale. Share your work with private links. '.repeat(12)}</p></div>
       ${download}${transcript}<section><h2>More Decks</h2><p>関連資料の宣伝です。</p></section></main></body></html>`,
      { headers: { 'Content-Type': 'text/html' } },
    );
  }

  it('Speaker Deckでは広告の後にあるTranscriptからスライド本文を順番に取得する', async () => {
    const slides = Array.from({ length: 7 }, (_, index) => `${index + 1}. ${slideText}`);
    const transcript = `<section><div><h2>Transcript</h2><span>7 slides</span></div><ol>${slides
      .map(
        (slide, index) =>
          `<li><h3><a href="${slideFiles}/slide_${index}.jpg">${slide}</a></h3><p>補足${index + 1}</p></li>`,
      )
      .join('')}</ol></section>`;
    const requests = mockNetwork(() =>
      deckPage(transcript, `<a href="${deckPdf}">Download PDF</a>`),
    );
    await expect(fetchArticle(env, deckUrl)).resolves.toMatchObject({
      title: 'テスト資料',
      text: slides.map((slide, index) => `${slide}\n補足${index + 1}`).join('\n\n'),
    });
    expect(requests).toEqual([deckUrl]);
  });

  it('Speaker DeckのTranscriptが空なら掲載されているPDFを既存のPDF Workerで読む', async () => {
    const requests = mockNetwork((url) =>
      url.href === deckPdf
        ? new Response(pdfFixture([pdfArticleText]), {
            headers: { 'Content-Type': 'application/pdf' },
          })
        : deckPage(
            '',
            `<a href="${otherDeckPdf}">Related deck PDF</a><a href="${deckPdf}">Download PDF</a>`,
          ),
    );
    const article = await fetchArticle(env, deckUrl);
    expect(article.title).toBe('テスト資料');
    expect(article.text.replace(/\s+/g, ' ')).toBe(pdfArticleText.trim());
    expect(requests).toEqual([deckUrl, deckPdf]);
  });

  it('Speaker Deckの短いTranscriptは取得失敗時の本文として記録する', async () => {
    const short = '最初のスライドの短い説明。';
    const requests = mockNetwork(() =>
      deckPage(`<ol class="speakerdeck-transcript"><li>${short}</li></ol>`),
    );
    const retainShortText = vi.fn(async () => {});
    await expect(fetchArticle(env, deckUrl, undefined, retainShortText)).rejects.toThrow(
      /Speaker Deckの資料本文を十分に取得できませんでした/,
    );
    expect(retainShortText).toHaveBeenCalledExactlyOnceWith(short);
    expect(requests).toEqual([deckUrl]);
  });

  it.each([
    { restriction: 'リンクなし', error: /資料本文を十分に取得/ },
    { restriction: 'robots拒否', error: /robots\.txt.*禁止/ },
    { restriction: '別サイトへの移動', error: /公開PDFを取得できませんでした/ },
    { restriction: '別資料への移動', error: /公開PDFを取得できませんでした/ },
    { restriction: 'PDF以外への移動', error: /公開PDFを取得できませんでした/ },
    { restriction: 'PDF以外の応答', error: /公開PDFを取得できませんでした/ },
  ])(
    'B09 Speaker Deckの広告だけを本文にせず、公開PDFの取得条件を守る（$restriction）',
    async ({ restriction, error }) => {
      const redirects: Record<string, string> = {
        別サイトへの移動: 'https://example.com/unrelated.pdf',
        別資料への移動: otherDeckPdf,
        PDF以外への移動: `${slideFiles}/slide_0.jpg`,
      };
      const requests = mockNetwork(
        (url) => {
          if (url.href === deckPdf) {
            if (restriction === 'PDF以外の応答') return deckPage();
            return new Response(null, {
              status: 302,
              headers: {
                Location: redirects[restriction],
              },
            });
          }
          return deckPage(
            '',
            restriction === 'リンクなし'
              ? `<script type="application/json">${JSON.stringify({ pdf: deckPdf })}</script><a href="${otherDeckPdf}">Related deck PDF</a>`
              : `<a href="${deckPdf}">Download PDF</a>`,
          );
        },
        (url) =>
          restriction === 'robots拒否' && url.hostname === 'files.speakerdeck.com'
            ? new Response('User-agent: *\nDisallow: /presentations/')
            : new Response(null, { status: 404 }),
      );
      const retainShortText = vi.fn(async () => {});
      await expect(fetchArticle(env, deckUrl, undefined, retainShortText)).rejects.toThrow(error);
      expect(retainShortText).not.toHaveBeenCalled();
      expect(requests).toEqual(
        restriction === 'リンクなし' || restriction === 'robots拒否'
          ? [deckUrl]
          : [deckUrl, deckPdf],
      );
    },
  );

  it.each([
    ['<meta property="og:image" content="../cover.png">', 'https://example.com/cover.png'],
    [
      '<meta property="og:image" content="javascript:alert(1)"><meta name="twitter:image" content="//cdn.example.com/cover.png">',
      'https://cdn.example.com/cover.png',
    ],
    [
      '<meta property="og:image" content="/cover.png"><meta property="og:image:secure_url" content="https://cdn.example.com/secure.png">',
      'https://cdn.example.com/secure.png',
    ],
    ['<meta property="og:image" content="data:image/png;base64,abc">', undefined],
  ])('OGP画像を本文抽出前に読み、移動後のURLを基準に解決する: %s', async (metadata, expected) => {
    const requests = mockNetwork((url) =>
      url.pathname === '/start'
        ? new Response(null, { status: 302, headers: { Location: '/folder/article' } })
        : new Response(
            `<html><head><title>通常のタイトル</title><meta property="og:title" content="OGPのタイトル">${metadata}</head><body><article><p>${articleText}</p></article></body></html>`,
            { headers: { 'Content-Type': 'text/html' } },
          ),
    );
    const result = await fetchArticle(env, 'https://example.com/start');
    expect(result.ogImageUrl).toBe(expected);
    expect(result.title).toBe('OGPのタイトル');
    expect(result.text).toContain(articleText);
    expect(requests).toHaveLength(2);
  });

  const htmlPage = (body: string, next = '', htmlBytes?: number) => {
    const html = `<html><head><title>同じ記事</title>${next ? `<link rel="next" href="${next}">` : ''}</head><body><article><h1>同じ記事</h1><p>${body}</p></article></body></html>`;
    const size = new TextEncoder().encode(html).byteLength;
    return new Response(`${html}${' '.repeat((htmlBytes ?? size) - size)}`, {
      headers: { 'Content-Type': 'text/html' },
    });
  };
  it.each([
    ['/article/open', true],
    ['/article/open?raw=1', false],
    ['/article/other', false],
    ['/article/%6Fpen', true],
    ['/article/日本語', false],
    ['/news/draft.md', false],
    ['/news/live', true],
    ['/shared-policy', false],
    ['/invalid-agent-policy', false],
  ])(
    'robots.txtのUser-agent・最長一致・ワイルドカード・URLの表記を判定する: %s',
    async (path, allowed) => {
      const robots = vi.fn((_url: URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).get('User-Agent')).toMatch(/^PufuLens\//);
        return new Response(`
User-agent: *
Disallow: /
User-agent: OtherBot
Disallow: /
User-agent: pUFULens
Disallow: /article/
Disallow: *.md
Allow: /article/open$ # 完全一致を許可
User-agent: PufuLens
Disallow: /article/open$
Disallow: /article/日本語
User-agent: invalid agent
Disallow: /invalid-agent-policy
User-agent: PufuLens
Disallow: invalid pattern
User-agent: OtherBot
Disallow: /shared-policy
`);
      });
      const requests = mockNetwork(() => htmlPage(articleText), robots);
      const article = fetchArticle(env, `https://example.com${path}`);
      if (allowed) await expect(article).resolves.toMatchObject({ text: expect.any(String) });
      else await expect(article).rejects.toThrow(/robots\.txt.*禁止/);
      expect(robots).toHaveBeenCalledTimes(1);
      expect(requests).toEqual(allowed ? [new URL(path, 'https://example.com').href] : []);
    },
  );

  it('別オリジンへの移動先は、リダイレクトされたrobots.txtを確認してから取得する', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const robots = vi.fn((url: URL) =>
      url.hostname === 'example.com'
        ? new Response(null, { status: 404 })
        : new Response(null, {
            status: 302,
            headers: { Location: 'https://cdn.com/rules.txt' },
          }),
    );
    const requests = mockNetwork((url) => {
      if (url.pathname === '/start')
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://second.com/blocked' },
        });
      if (url.pathname === '/rules.txt') return new Response('User-agent: *\nDisallow: /blocked');
      return htmlPage(articleText);
    }, robots);
    await expect(fetchArticle(env, 'https://example.com/start')).rejects.toThrow(
      /robots\.txt.*禁止/,
    );
    expect(errors).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ reason: 'robots_disallowed', http_status: 302 }),
    );
    expect(robots.mock.calls.map(([url]) => url.href)).toEqual([
      'https://example.com/robots.txt',
      'https://second.com/robots.txt',
    ]);
    expect(requests).toEqual(['https://example.com/start', 'https://cdn.com/rules.txt']);
  });

  it.each([206, 429, 503])(
    'robots.txtを確認できなければ本文を取得しない: HTTP %s',
    async (status) => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const requests = mockNetwork(
        () => htmlPage(articleText),
        () => new Response(null, { status }),
      );
      await expect(fetchArticle(env, 'https://example.com/story')).rejects.toThrow(
        /robots\.txt.*確認できなかった/,
      );
      expect(requests).toEqual([]);
      expect(errors).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          event: 'article_fetch_failed',
          stage: 'fetch',
          reason: 'robots_unavailable',
          robots_http_status: status,
        }),
      );
    },
  );

  it.each(['/story', '/st%6fry'])(
    'robots.txtが対象記事へ移動する場合は記事に接続しない: %s',
    async (location) => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const requests = mockNetwork(
        () => htmlPage(articleText),
        () => new Response(null, { status: 302, headers: { Location: location } }),
      );
      await expect(fetchArticle(env, 'https://example.com/story')).rejects.toThrow(
        /robots\.txt.*確認できなかった/,
      );
      expect(requests).toEqual([]);
      expect(errors).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ reason: 'robots_unavailable', robots_http_status: 302 }),
      );
    },
  );

  it('robots.txtで禁止された次ページは取得せず、それまでの本文を保持する', async () => {
    const robots = vi.fn(() => new Response('User-agent: *\nDisallow: /story/42/page/2'));
    const requests = mockNetwork(() => htmlPage(articleText, '/story/42/page/2'), robots);
    const result = await fetchArticle(env, 'https://example.com/story/42');
    expect(result).toMatchObject({ pages: ['https://example.com/story/42'], complete: false });
    expect(result.text).toContain(articleText);
    expect(requests).toEqual(result.pages);
    expect(robots).toHaveBeenCalledTimes(1);
  });

  it('同じ記事の次ページを取得し、後半の本文と取得情報を返す', async () => {
    const last = '後半でのみ説明する条件：星や雨の表現を保ち、監督と確認する。'.repeat(10);
    const requests = mockNetwork((url) =>
      url.pathname.endsWith('/2')
        ? htmlPage(last, '', 3 * 1024 * 1024)
        : htmlPage(articleText, '/story/42/page/2', 3 * 1024 * 1024),
    );
    const result = await fetchArticle(env, 'https://example.com/story/42');
    expect(result.text).toContain(articleText);
    expect(result.text).toContain(last);
    expect(result.pages).toEqual([
      'https://example.com/story/42',
      'https://example.com/story/42/page/2',
    ]);
    expect(result.complete).toBe(true);
    expect(requests).toHaveLength(2);
  });
  it.each(['https://elsewhere.example/story/42/page/2', '/story/99', 'http://127.0.0.1/private'])(
    '記事以外の次リンクには接続せず、一部取得を返す: %s',
    async (next) => {
      const requests = mockNetwork(() => htmlPage(articleText, next));
      const result = await fetchArticle(env, 'https://example.com/story/42');
      expect(requests).toEqual(['https://example.com/story/42']);
      expect(result.text).toContain(articleText);
      expect(result.complete).toBe(false);
    },
  );
  it('次ページが別originや内部IPへリダイレクトしても接続しない', async () => {
    for (const destination of [
      'https://elsewhere.example/story/42/page/2',
      'http://127.0.0.1/private',
    ]) {
      const requests = mockNetwork((url) =>
        url.pathname.endsWith('/2')
          ? new Response(null, { status: 302, headers: { Location: destination } })
          : htmlPage(articleText, '/story/42/page/2'),
      );
      const result = await fetchArticle(env, 'https://example.com/story/42');
      expect(requests).toEqual([
        'https://example.com/story/42',
        'https://example.com/story/42/page/2',
      ]);
      expect(result.complete).toBe(false);
    }
  });
  it('続きの取得失敗でも先に取得した本文を保持する', async () => {
    mockNetwork((url) =>
      url.pathname.endsWith('/2')
        ? new Response(null, { status: 503 })
        : htmlPage(articleText, '/story/42/page/2'),
    );
    const result = await fetchArticle(env, 'https://example.com/story/42');
    expect(result.text).toContain(articleText);
    expect(result.pages).toEqual(['https://example.com/story/42']);
    expect(result.complete).toBe(false);
  });
  it('5ページで停止し、続きがあることを記録する', async () => {
    const requests = mockNetwork((url) => {
      const n = Number(url.pathname.match(/page\/(\d+)/)?.[1] ?? 1);
      return htmlPage(`ページ${n}。${articleText}`, `/story/42/page/${n + 1}`);
    });
    const result = await fetchArticle(env, 'https://example.com/story/42');
    expect(requests).toHaveLength(5);
    expect(result.pages).toHaveLength(5);
    expect(result.complete).toBe(false);
  });
  it('次リンクの循環を検出し、同じページを再取得しない', async () => {
    const requests = mockNetwork((url) =>
      htmlPage(
        articleText + url.pathname,
        url.pathname.endsWith('/2') ? '/story/42' : '/story/42/page/2',
      ),
    );
    expect((await fetchArticle(env, 'https://example.com/story/42')).complete).toBe(false);
    expect(requests).toHaveLength(2);
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

  it.each([
    ['text/html', 3, true],
    ['application/xhtml+xml', 3, false],
    ['text/plain', 2, true],
    ['text/plain', 2, false],
  ])(
    '%sは%dMBを超えると拒否する（Content-Lengthあり: %s）',
    async (contentType, maxMiB, declared) => {
      const size = maxMiB * 1024 * 1024 + 1;
      mockNetwork(
        () =>
          new Response(declared ? '本文' : new Uint8Array(size), {
            headers: {
              'Content-Type': contentType,
              ...(declared ? { 'Content-Length': String(size) } : {}),
            },
          }),
      );
      await expect(fetchArticle(env, 'https://example.com/large')).rejects.toThrow(
        `ページが大きすぎます（上限${maxMiB}MB）。`,
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

  it.each([
    { error: 'PDFを読み取れませんでした。', short_text: 'partial text' },
    { error: pdfInsufficientTextMessage, short_text: 'a'.repeat(200) },
    { error: pdfInsufficientTextMessage, short_text: ' ' },
  ])('PDFの短文保存条件に合わない応答を保持しない ($#)', async (result) => {
    mockNetwork(() => new Response('PDF', { headers: { 'Content-Type': 'application/pdf' } }));
    const parser = {
      async fetch() {
        return Response.json(result, { status: 422 });
      },
    } as unknown as Fetcher;
    const retainShortText = vi.fn(async () => {});
    await expect(
      fetchArticle(
        { ...env, PDF_PARSER: parser },
        'https://example.com/paper.pdf',
        undefined,
        retainShortText,
      ),
    ).rejects.toThrow(result.error);
    expect(retainShortText).not.toHaveBeenCalled();
  });

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
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
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
      expect(errors).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ stage: 'parse_pdf', reason: 'body_too_large', http_status: 200 }),
      );
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
  ])('%sを理由付きで拒否する', async (name, pdf, error) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockNetwork(
      () =>
        new Response(pdf as Uint8Array<ArrayBuffer>, {
          headers: { 'Content-Type': 'application/pdf' },
        }),
    );
    await expect(fetchArticle(env, 'https://example.com/paper.pdf')).rejects.toThrow(
      error as RegExp,
    );
    if (name === '文字情報のないPDF') {
      expect(errors).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          stage: 'parse_pdf',
          reason: 'insufficient_text',
          http_status: 200,
        }),
      );
    }
  });
});
