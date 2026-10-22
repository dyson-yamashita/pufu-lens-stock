import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPdfService, createPdfWorker } from './pdf-worker-helper';
import { japanesePdfFixture, japanesePdfText, pdfArticleText, pdfFixture } from './pdf-fixture';

describe('PDF専用Workerの入力制限と回復', () => {
  let worker: Awaited<ReturnType<typeof createPdfWorker>>;
  beforeAll(async () => {
    worker = await createPdfWorker();
  });
  afterAll(async () => worker?.dispose());

  it('本体の取得経路を通らない入力も10MiBで拒否し、次のPDFは解析できる', async () => {
    const response = await worker.parser.fetch(
      new Request('https://example.com/large.pdf', {
        method: 'POST',
        body: new Uint8Array(10 * 1024 * 1024 + 1),
      }),
    );
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toMatch(/PDF.*10MB/);
    const next = await worker.parser.fetch(
      new Request('https://example.com/next.pdf', {
        method: 'POST',
        body: pdfFixture([pdfArticleText], '次の記事'),
      }),
    );
    expect(next.status).toBe(200);
    expect(await next.json()).toMatchObject({ title: '次の記事' });
  });

  it('同じisolateで解析を重ねず、処理終了後に受付を再開する', async () => {
    let finish!: () => void;
    const pdf = pdfFixture([pdfArticleText]);
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(pdf.subarray(0, 1));
        finish = () => {
          controller.enqueue(pdf.subarray(1));
          controller.close();
        };
      },
    });
    const first = worker.parser.fetch(
      new Request('https://example.com/first.pdf', {
        method: 'POST',
        body: input,
        duplex: 'half',
      } as RequestInit),
    );
    try {
      await expect
        .poll(
          async () => {
            const busy = await worker.parser.fetch(
              new Request('https://example.com/busy.pdf', {
                method: 'POST',
                body: 'not a PDF',
              }),
            );
            return busy.status;
          },
          { timeout: 2000, interval: 10 },
        )
        .toBe(503);
    } finally {
      finish();
      expect((await first).status).toBe(200);
    }
    const next = await worker.parser.fetch(
      new Request('https://example.com/next.pdf', {
        method: 'POST',
        body: pdfFixture([pdfArticleText]),
      }),
    );
    expect(next.status).toBe(200);
  });
});

it('本体のPDFクライアントから実サービスバインディングで日本語PDFを解析する', async () => {
  const { runtime, dispose } = await createPdfService();
  try {
    const result = await runtime.dispatchFetch('https://example.com/japanese.pdf', {
      method: 'POST',
      body: japanesePdfFixture(),
    });
    expect(result.status).toBe(200);
    expect(((await result.json()) as { text: string }).text).toContain(japanesePdfText);
  } finally {
    await dispose();
  }
});

it('本体のタイムアウトで中断した入力を解放し、次の正常PDFを解析できる', async () => {
  const { runtime, dispose } = await createPdfService();
  try {
    const stalled = await runtime.dispatchFetch('https://example.com/stalled');
    expect(stalled.status).toBe(500);
    expect(await stalled.json()).toMatchObject({ error: expect.stringMatching(/PDF.*本文を補完/) });
    let next!: Awaited<ReturnType<typeof runtime.dispatchFetch>>;
    await expect
      .poll(
        async () => {
          next = await runtime.dispatchFetch('https://example.com/next.pdf', {
            method: 'POST',
            body: pdfFixture([pdfArticleText], '中断後の記事'),
          });
          return next.status;
        },
        { timeout: 2000, interval: 20 },
      )
      .toBe(200);
    expect(await next.json()).toMatchObject({ title: '中断後の記事' });
    const cancellations = await runtime.dispatchFetch('https://example.com/cancellations');
    expect(await cancellations.json()).toEqual({ cancellations: 1 });
  } finally {
    await dispose();
  }
}, 30000);
