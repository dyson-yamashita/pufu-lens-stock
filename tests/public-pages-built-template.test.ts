import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, type Rollup } from 'vite';
import { parseHTML } from 'linkedom';
import { legalPagesPlugin } from '../scripts/legal-pages-plugin';
import worker from '../server/index';
import { testApp } from './helpers';

let root: string;
let builtHome: string;
let app: Awaited<ReturnType<typeof testApp>>;
let key: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pufu-public-built-')));
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  await writeFile(join(root, 'index.html'), html.replace('/src/main.tsx', '/entry.js'));
  await writeFile(join(root, 'entry.js'), "import './style.css'; console.log('app');");
  await writeFile(join(root, 'style.css'), 'body { color: black; }');
  const result = (await build({
    configFile: false,
    root,
    plugins: [legalPagesPlugin()],
    logLevel: 'silent',
    build: { write: false },
  })) as Rollup.RollupOutput;
  const index = result.output.find(
    (output) => output.type === 'asset' && output.fileName === 'index.html',
  );
  builtHome = String(index && index.type === 'asset' ? index.source : '');
  expect(builtHome).toContain('<!--public-root-start-->');
  expect(builtHome).toContain('link');
  expect(builtHome).toMatch(/rel=["']?canonical["']?/i);
  expect(builtHome).toMatch(/hreflang=/i);

  app = await testApp();
  app.env.ASSETS = {
    fetch: async (request: Request) =>
      new URL(request.url).pathname === '/index.html'
        ? Response.redirect(`${app.env.APP_URL}/`, 307)
        : new Response(builtHome),
  } as unknown as Fetcher;
  const published = await app.request('/api/v1/projects/alice-project/publication', {
    method: 'PATCH',
    body: {
      is_public: true,
      search_indexable: true,
      public_description: '公開紹介',
    },
  });
  key = ((await published.json()) as { publication: { public_id: string } }).publication.public_id;
  await app.env.DB.prepare(
    "INSERT INTO questions (id,project_id,source,text,status) VALUES ('q','alice-project','user','実践の問い？','ready')",
  ).run();
}, 120_000);

afterAll(async () => {
  await app?.dispose();
  if (root) await rm(root, { recursive: true, force: true });
});

it('ビルド済みホームHTMLをテンプレートにしても公開ページが200で固有canonical・descriptionになる', async () => {
  const canonical = `${app.env.APP_URL}/p/${key}/questions/q`;
  const response = await worker.fetch(new Request(canonical), app.env, app.ctx);
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain('実践の問い？');
  expect(html).not.toContain('記事をプロジェクトにストック');
  const { document } = parseHTML(html);
  const canonicals = [...document.querySelectorAll('link[rel="canonical"]')];
  expect(canonicals).toHaveLength(1);
  expect(canonicals[0]?.getAttribute('href')).toBe(canonical);
  expect(document.querySelectorAll('link[hreflang]')).toHaveLength(0);
  expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
    '実践の問い？',
  );
  expect(html).not.toContain('SoftwareApplication');
});
