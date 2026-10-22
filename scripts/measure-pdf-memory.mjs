// 実際のextractPdfを文書ごとに新しいNodeプロセスとworkerd isolateで測る。
// ネットワーク取得・本番アクセスは行わない。追加のPDFはローカルパスで渡す。
import { build } from 'esbuild';
import { Buffer } from 'node:buffer';
import { Miniflare } from 'miniflare';
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const { URL, Response, performance } = globalThis;
const root = fileURLToPath(new URL('../', import.meta.url));
const mib = (bytes) => Math.round((bytes / 1024 ** 2) * 10) / 10;
const memory = () => {
  const usage = process.memoryUsage();
  return Object.fromEntries(
    ['rss', 'heapUsed', 'external', 'arrayBuffers'].map((key) => [key, mib(usage[key])]),
  );
};
const assets = {
  async fetch(input) {
    const name = new URL(String(input)).pathname.split('/').pop();
    if (!/^[A-Za-z0-9_-]+\.bcmap$/.test(name)) throw new Error('Invalid CMap');
    return new Response(await readFile(resolve(root, 'node_modules/pdfjs-dist/cmaps', name)));
  },
};

if (process.argv[2] === '--child') {
  const { extractPdf, getResolvedPDFJS } = await import(pathToFileURL(process.argv[3]).href);
  await getResolvedPDFJS();
  const data = new Uint8Array(await readFile(process.argv[4]));
  globalThis.gc();
  const beforeMiB = memory();
  const started = performance.now();
  let result;
  try {
    const { text } = await extractPdf(data, new URL('https://example.com/paper.pdf'), assets);
    result = { characters: text.length };
  } catch (error) {
    result = { error: error.message };
  }
  console.log(
    JSON.stringify({
      beforeMiB,
      afterMiB: memory(),
      // Node起動からの最大RSS。JSヒープだけの値でも、Workersのメモリ値でもない。
      peakRssMiB: mib(process.resourceUsage().maxRSS * 1024),
      elapsedMs: Math.round(performance.now() - started),
      result,
    }),
  );
} else {
  const directory = resolve(root, '.cache/pdf-memory');
  await mkdir(directory, { recursive: true });
  const temporary = await mkdtemp(resolve(directory, 'run-'));
  try {
    const { outputFiles } = await build({
      stdin: {
        contents:
          "export {extractPdf} from './server/pdf.ts'; export {getResolvedPDFJS} from 'unpdf';",
        resolveDir: root,
      },
      bundle: true,
      format: 'esm',
      platform: 'browser',
      external: ['node:*'],
      write: false,
    });
    const bundle = resolve(temporary, 'parser.mjs');
    await writeFile(bundle, outputFiles[0].text);
    const files = [];
    for (const [name, pages, paddingBytes] of [
      ['article-10-pages', 10, 0],
      ['article-40-pages', 40, 0],
      ['padding-8-MiB', 1, 8 * 1024 ** 2],
      ['padding-64-MiB', 1, 64 * 1024 ** 2],
      ['padding-128-MiB', 1, 128 * 1024 ** 2],
    ]) {
      const file = resolve(temporary, `${name}.pdf`);
      await writeFile(file, compressedPdf(pages, paddingBytes));
      files.push(file);
    }
    files.push(...process.argv.slice(2).map((file) => resolve(file)));
    for (const file of files) {
      const child = spawnSync(
        process.execPath,
        ['--expose-gc', fileURLToPath(import.meta.url), '--child', bundle, file],
        { encoding: 'utf8', timeout: 45000, maxBuffer: 1024 ** 2 },
      );
      if (child.error || child.status !== 0)
        throw child.error ?? new Error(child.stderr || `Child exited: ${child.status}`);
      const node = JSON.parse(child.stdout);
      const workerd = await measureWorkerd(outputFiles[0].text, file);
      console.log(JSON.stringify({ file, bytes: (await readFile(file)).length, node, workerd }));
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function compressedPdf(pages, paddingBytes) {
  const lines = Array.from(
    { length: 40 },
    (_, line) => `(Article line ${line}: saving documents and testing extraction.) Tj T*`,
  ).join(' ');
  const stream = deflateSync(' '.repeat(paddingBytes) + `BT /F1 10 Tf 50 740 Td 14 TL ${lines} ET`);
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from(
      `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(' ')}] >>`,
    ),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ];
  for (let i = 0; i < pages; i++) {
    objects.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
      ),
      Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`),
        stream,
        Buffer.from('\nendstream'),
      ]),
    );
  }
  let length = 9;
  const offsets = [];
  const chunks = [Buffer.from('%PDF-1.7\n')];
  for (const [i, object] of objects.entries()) {
    offsets.push(length);
    const chunk = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`),
      object,
      Buffer.from('\nendobj\n'),
    ]);
    chunks.push(chunk);
    length += chunk.length;
  }
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`,
    ),
  );
  return Buffer.concat(chunks);
}

async function measureWorkerd(source, file) {
  const runtime = new Miniflare({
    name: 'pdf-memory',
    modules: true,
    script:
      source +
      `\nexport default { async fetch(request, env) {
        if (request.method === 'GET') { await getResolvedPDFJS(); return new Response(null); }
        try {
          const {text} = await extractPdf(new Uint8Array(await request.arrayBuffer()), new URL(request.url), env.ASSETS);
          return Response.json({characters:text.length});
        } catch (error) { return Response.json({error:error.message}); }
      } };`,
    compatibilityDate: '2026-07-30',
    compatibilityFlags: ['nodejs_compat'],
    inspectorPort: 0,
    serviceBindings: { ASSETS: (request) => assets.fetch(request.url) },
  });
  let socket;
  try {
    await runtime.dispatchFetch('https://example.com/paper.pdf');
    const url = await runtime.getInspectorURL();
    url.protocol = 'http:';
    url.pathname = '/json/list';
    const targets = await (await fetch(url)).json();
    socket = new globalThis.WebSocket(
      targets.find((target) => target.id === 'core:user:pdf-memory').webSocketDebuggerUrl,
    );
    let sequence = 0;
    await inspectorResponse(socket);
    const heap = async () => {
      const message = await inspectorResponse(socket, ++sequence);
      if (message.error) throw new Error(JSON.stringify(message.error));
      return Object.fromEntries(
        Object.entries(message.result).map(([key, value]) => [key, mib(value)]),
      );
    };
    const beforeMiB = await heap();
    const response = await runtime.dispatchFetch('https://example.com/paper.pdf', {
      method: 'POST',
      body: await readFile(file),
    });
    const result = await response.json();
    return { beforeMiB, afterMiB: await heap(), result };
  } finally {
    socket?.close();
    await runtime.dispose();
  }
}

function inspectorResponse(socket, id) {
  const controller = new globalThis.AbortController();
  let timer;
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error('Inspector connection closed or failed'));
    const options = { signal: controller.signal };
    timer = globalThis.setTimeout(() => reject(new Error('Inspector timed out')), 10000);
    socket.addEventListener('close', fail, options);
    socket.addEventListener('error', fail, options);
    if (id === undefined) {
      socket.addEventListener('open', resolve, options);
    } else {
      socket.addEventListener(
        'message',
        (event) => {
          try {
            const message = JSON.parse(event.data);
            if (message.id === id) resolve(message);
          } catch (error) {
            reject(error);
          }
        },
        options,
      );
      socket.send(JSON.stringify({ id, method: 'Runtime.getHeapUsage' }));
    }
  }).finally(() => {
    globalThis.clearTimeout(timer);
    controller.abort();
  });
}
