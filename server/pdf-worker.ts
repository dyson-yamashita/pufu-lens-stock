import { extractPdf } from './pdf';
import { limitedBytes } from './limited-bytes';
import cmaps from 'virtual:pdf-cmaps';

// CMap以外のサービス・保存先・認証情報を持たない専用Worker。
const assets = {
  async fetch(input: RequestInfo | URL): Promise<Response> {
    const name = new URL(String(input)).pathname.split('/').pop() ?? '';
    const encoded = /^[A-Za-z0-9_-]+\.bcmap$/.test(name) ? cmaps[name] : undefined;
    if (!encoded) return new Response(null, { status: 404 });
    return new Response(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)));
  },
};
// 同じisolateでPDFの解析を重ねない。混雑時はWorkflowの既存リトライへ戻す。
let activeRequest: symbol | undefined;
export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    if (activeRequest) return new Response(null, { status: 503 });
    const identity = Symbol();
    activeRequest = identity;
    const controller = new AbortController();
    const release = () => {
      if (activeRequest === identity) activeRequest = undefined;
    };
    const stop = (reason: unknown) => {
      // サービス呼び出し中断ではread()のfinallyが動かない場合もある。
      release();
      clearTimeout(timer);
      controller.abort(reason);
    };
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
        once: true,
      });
    });
    const timer = setTimeout(
      () =>
        stop(
          new Error('PDFの解析が時間内に完了しませんでした。本文を補完して再試行してください。'),
        ),
      20000,
    );
    const onAbort = () => stop(request.signal.reason);
    request.signal.addEventListener('abort', onAbort, { once: true });
    if (request.signal.aborted) onAbort();
    try {
      const operation = (async () => {
        const data = await limitedBytes(
          new Response(request.body, { headers: request.headers }),
          10 * 1024 * 1024,
          'PDFが大きすぎます（上限10MB）。',
          controller.signal,
        );
        return extractPdf(data, new URL(request.url), assets, controller.signal);
      })();
      return Response.json(await Promise.race([operation, aborted]));
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : 'PDFを読み取れませんでした。' },
        { status: 422 },
      );
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', onAbort);
      release();
    }
  },
};
