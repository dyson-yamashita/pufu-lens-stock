import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../server/api/app';
import { parsePdf } from '../server/features/stocks/pdf/pdf-client';
import type { Env } from '../server/env';
import { testApp } from './helpers';

let app: Awaited<ReturnType<typeof testApp>> | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await app?.dispose();
  app = undefined;
});

it('B14: R2保存中のpending画像を取得・再送で公開せず、完了後だけreadyにする', async () => {
  const current = (app = await testApp());
  await current.env.DB.batch([
    current.env.DB.prepare(
      "INSERT INTO articles(id,user_id,canonical_url,source_url,title,domain,source_type,status) VALUES('intake-a','alice','text:intake','','入力','','text','ready')",
    ),
    current.env.DB.prepare(
      "INSERT INTO stocks(id,user_id,project_id,article_id,note) VALUES('intake-s','alice','alice-project','intake-a','')",
    ),
  ]);
  const bytes = Uint8Array.from(
    readFileSync(new URL('./fixtures/stock-image.png', import.meta.url)),
  );
  const id = crypto.randomUUID();
  const base = '/api/v1/stocks/intake-s/images';
  const upload = () =>
    createApp().request(
      current.env.APP_URL + base,
      {
        method: 'POST',
        headers: {
          Cookie: 'stock_session=alice-session',
          Origin: current.env.APP_URL,
          'Content-Type': 'image/png',
          'X-File-Name': 'intake.png',
          'Idempotency-Key': id,
        },
        body: bytes,
      },
      current.env,
      current.ctx,
    );
  const bucket = current.env.CONTENT;
  const originalPut = bucket.put.bind(bucket);
  const put = vi.fn(async (...args: Parameters<R2Bucket['put']>) => {
    const pending = await current.env.DB.prepare('SELECT id,status FROM stock_images').all();
    expect(pending.results).toEqual([{ id, status: 'pending' }]);
    expect(await (await current.request(base)).json()).toEqual({ images: [] });
    expect((await current.request(`${base}/${id}`)).status).toBe(404);
    expect((await upload()).status).toBe(409);
    expect(
      (await current.env.DB.prepare('SELECT id,status FROM stock_images').all()).results,
    ).toEqual(pending.results);
    return originalPut(...args);
  });
  current.env.CONTENT = new Proxy(bucket, {
    get(target, property) {
      if (property === 'put') return put;
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  expect((await upload()).status).toBe(201);
  expect((await upload()).status).toBe(200);
  expect(put).toHaveBeenCalledOnce();
  expect(
    (await current.env.DB.prepare('SELECT id,status FROM stock_images').all()).results,
  ).toEqual([{ id, status: 'ready' }]);
  const image = await current.request(`${base}/${id}`);
  expect(image.status).toBe(200);
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(bytes);
});

it.each([
  { title: 't'.repeat(300), text: 'a'.repeat(200), accepted: true },
  { title: 't'.repeat(301), text: 'a'.repeat(200), accepted: false },
  { title: 't', text: 'a'.repeat(199), accepted: false },
  { title: 't', text: 'a'.repeat(120000), accepted: true },
  { title: 't', text: 'a'.repeat(120001), accepted: false },
])('B14: PDFサービス出力の文字数境界を採用前に検査する: %#', async ({ title, text, accepted }) => {
  const fetch = vi.fn<Fetcher['fetch']>().mockResolvedValue(Response.json({ title, text }));
  const env = { PDF_PARSER: { fetch } } as unknown as Env;
  const result = parsePdf(env, new Response('%PDF-fixture'), new URL('https://example.com/a.pdf'));
  if (accepted) await expect(result).resolves.toEqual({ title, text });
  else await expect(result).rejects.toThrow('PDFの解析を完了できませんでした');
  expect(fetch).toHaveBeenCalledOnce();
  const sent = fetch.mock.calls[0][0] as Request;
  expect(sent.method).toBe('POST');
  expect(sent.headers.get('Content-Type')).toBe('application/pdf');
});

it.each([
  { status: 422, error: undefined, accepted: true },
  { status: 422, error: 'PDFの診断エラー', accepted: false },
  { status: 503, error: undefined, accepted: false },
])(
  'B14: PDFサービスのHTTPとerrorの現行採用条件を照合する: $status/$accepted',
  async ({ status, error, accepted }) => {
    const value = { title: 'PDF', text: 'a'.repeat(200), error };
    const fetch = vi.fn<Fetcher['fetch']>().mockResolvedValue(Response.json(value, { status }));
    const result = parsePdf(
      { PDF_PARSER: { fetch } } as unknown as Env,
      new Response('%PDF-fixture'),
      new URL('https://example.com/a.pdf'),
    );
    if (accepted) await expect(result).resolves.toEqual({ title: value.title, text: value.text });
    else await expect(result).rejects.toThrow(error ?? 'PDFの解析を完了できませんでした');
  },
);
