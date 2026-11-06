import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, type Rollup } from 'vite';
import type { fetchArticle } from '../server/ingest';
import type { Env } from '../server/env';

let root: string | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});

it('ビルド後もCanvas要素を含む記事の本文と次ページを取得できる', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  const result = (await build({
    configFile: false,
    logLevel: 'silent',
    ssr: { noExternal: true, external: ['@cloudflare/playwright'] },
    build: {
      ssr: fileURLToPath(new URL('../server/ingest.ts', import.meta.url)),
      write: false,
    },
  })) as Rollup.RollupOutput;
  const entry = result.output.find((output) => output.type === 'chunk' && output.isEntry);
  if (!entry || entry.type !== 'chunk') throw new Error('記事取得のビルド成果物がありません。');
  root = await mkdtemp(join(tmpdir(), 'pufu-ingest-build-'));
  const file = join(root, 'ingest.mjs');
  await writeFile(file, entry.code);
  const built = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
    fetchArticle: typeof fetchArticle;
  };
  const first = 'Canvasを含むページでも記事本文を取り込み、要約へ渡せます。'.repeat(15);
  const second = '続きのページでも本文と取得完了の状態を保持します。'.repeat(15);
  const requests: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === 'cloudflare-dns.com')
      return Response.json({
        Status: 0,
        Answer: url.searchParams.get('type') === 'A' ? [{ type: 1, data: '8.8.8.8' }] : [],
      });
    requests.push(url.href);
    const last = url.pathname.endsWith('/2');
    return new Response(
      `<html><head><title>Canvasを含む記事</title>${last ? '' : '<link rel="next" href="/story/page/2">'}</head><body><canvas></canvas><article><h1>Canvasを含む記事</h1><p>${last ? second : first}</p></article></body></html>`,
      { headers: { 'Content-Type': 'text/html' } },
    );
  });

  const article = await built.fetchArticle({} as Env, 'https://example.com/story');
  expect(article.title).toBe('Canvasを含む記事');
  expect(article.text).toContain(first);
  expect(article.text).toContain(second);
  expect(article.pages).toEqual(['https://example.com/story', 'https://example.com/story/page/2']);
  expect(article.complete).toBe(true);
  expect(requests).toEqual(article.pages);
});
