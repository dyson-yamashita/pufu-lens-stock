import type { Env } from './env';
import { limitedBytes } from './limited-bytes';

const unavailable = 'PDFの解析を完了できませんでした。本文を補完して再試行してください。';
class PdfParserError extends Error {}

// PDF.jsはここへimportしない。資源超過はサービス境界で取り込み失敗にする。
export async function parsePdf(
  env: Env,
  source: Response,
  url: URL,
): Promise<{ title: string; text: string }> {
  if (Number(source.headers.get('Content-Length')) > 10 * 1024 * 1024) {
    await source.body?.cancel();
    throw new Error('PDFが大きすぎます（上限10MB）。');
  }
  const parser = env.PDF_PARSER;
  if (!parser) {
    await source.body?.cancel();
    throw new Error(unavailable);
  }
  const controller = new AbortController();
  // 取得元readerを本体で保持し、サービス中断時にも取得元のcancelを確実に呼ぶ。
  const reader = source.body?.getReader();
  const body = reader
    ? new ReadableStream<Uint8Array>({
        async pull(stream) {
          const { done, value } = await reader.read();
          if (done) stream.close();
          else stream.enqueue(value);
        },
        cancel: (reason) => reader.cancel(reason),
      })
    : undefined;
  controller.signal.addEventListener(
    'abort',
    () => {
      void reader?.cancel(controller.signal.reason).catch(() => undefined);
    },
    { once: true },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await parser.fetch(
          new Request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/pdf' },
            body,
            duplex: 'half',
            signal: controller.signal,
          } as RequestInit),
        );
        if (!response.ok && response.status !== 422) {
          await response.body?.cancel();
          throw new Error(unavailable);
        }
        const bytes = await limitedBytes(response, 1024 * 1024, unavailable, controller.signal);
        const result = JSON.parse(new TextDecoder().decode(bytes));
        if (response.status === 422 && typeof result.error === 'string')
          throw new PdfParserError(result.error.slice(0, 400));
        if (
          typeof result.title !== 'string' ||
          result.title.length > 300 ||
          typeof result.text !== 'string' ||
          result.text.length < 200 ||
          result.text.length > 120000
        )
          throw new Error(unavailable);
        return { title: result.title, text: result.text };
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(unavailable));
        }, 20000);
      }),
    ]);
  } catch (error) {
    if (error instanceof PdfParserError) throw error;
    throw new Error(unavailable);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
