import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { pdfCmapsSource } from '../scripts/pdf-cmaps-plugin';

let bundle: Promise<string> | undefined;
export function pdfWorkerSource(): Promise<string> {
  bundle ??= build({
    entryPoints: [new URL('../server/pdf-worker.ts', import.meta.url).pathname],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    external: ['node:*'],
    plugins: [
      {
        name: 'pdf-cmaps',
        setup(builder) {
          builder.onResolve({ filter: /^virtual:pdf-cmaps$/ }, () => ({
            path: 'cmaps',
            namespace: 'pdf-cmaps',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'pdf-cmaps' }, () => ({
            contents: pdfCmapsSource(),
            loader: 'js',
          }));
        },
      },
    ],
  }).then(({ outputFiles }) => outputFiles[0].text);
  return bundle;
}

export async function createPdfWorker() {
  const runtime = new Miniflare({
    modules: true,
    script: await pdfWorkerSource(),
    compatibilityDate: '2026-07-30',
    compatibilityFlags: ['nodejs_compat', 'enable_request_signal'],
    outboundService: async () => {
      throw new Error('PDF解析Workerは外部通信を行わない');
    },
  });
  return {
    parser: {
      // Node組み込みRequestとMiniflareのRequest実装の境界をURL/initで接続する。
      fetch(request: Request) {
        return runtime.dispatchFetch(request.url, {
          method: request.method,
          headers: Object.fromEntries(request.headers),
          body: request.body,
          duplex: 'half',
        } as Parameters<typeof runtime.dispatchFetch>[1]);
      },
    } as unknown as Fetcher,
    dispose: () => runtime.dispose(),
  };
}

export async function createPdfService({ manualClock = false } = {}) {
  const { outputFiles } = await build({
    stdin: {
      contents: `import {parsePdf} from './server/pdf-client.ts';
        ${manualClock ? "import {advanceClock} from './tests/pdf-test-clock.ts';" : ''}
        let cancellations = 0;
        export default { async fetch(request, env) {
          const path = new URL(request.url).pathname;
          ${manualClock ? "if (path === '/__test/clock') return Response.json(advanceClock(Number(new URL(request.url).searchParams.get('advance') ?? 0)));" : ''}
          if (path === '/cancellations') return Response.json({cancellations});
          const source = path === '/stalled'
            ? new Response(new ReadableStream({start(controller) {controller.enqueue(new Uint8Array([37]));}, cancel() {cancellations++;}}))
            : new Response(request.body);
          try {return Response.json(await parsePdf(env, source, new URL(request.url)));}
          catch (error) {return Response.json({error:error.message}, {status:500});}
        } };`,
      resolveDir: new URL('../', import.meta.url).pathname,
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    inject: manualClock ? [new URL('./pdf-test-clock.ts', import.meta.url).pathname] : [],
  });
  const runtime = new Miniflare({
    workers: [
      {
        name: 'app',
        modules: true,
        script: outputFiles[0].text,
        compatibilityDate: '2026-07-30',
        serviceBindings: { PDF_PARSER: 'pdf' },
      },
      {
        name: 'pdf',
        modules: true,
        script: await pdfWorkerSource(),
        compatibilityDate: '2026-07-30',
        compatibilityFlags: ['nodejs_compat', 'enable_request_signal'],
      },
    ],
  });
  return { runtime, dispose: () => runtime.dispose() };
}
