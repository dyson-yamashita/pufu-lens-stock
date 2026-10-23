import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { build, type Rollup } from 'vite';
import { parseHTML } from 'linkedom';
import { legalPagesPlugin } from '../scripts/legal-pages-plugin';

let root: string;
let assets: Map<string, string>;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pufu-legal-build-')));
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  await writeFile(join(root, 'index.html'), html.replace('/src/main.tsx', '/entry.js'));
  await writeFile(join(root, 'entry.js'), "import './style.css'; console.log('app');");
  await writeFile(join(root, 'style.css'), 'body { color: black; }');
  const result = (await build({
    configFile: false,
    root,
    plugins: [
      legalPagesPlugin(),
      {
        name: 'legal-page-script-fixtures',
        transformIndexHtml: {
          order: 'post',
          handler: (html) =>
            html.replace(
              '</head>',
              `<script type='module' data-test="single-quoted">console.log('module');</script>
              <SCRIPT TYPE=module data-test="unquoted">console.log('module');</SCRIPT>
              <script type="MODULE" data-test="uppercase">console.log('module');</script>
              <script data-note='type="module"' data-test="classic">console.log('classic');</script>
              <script type="application/ld+json" data-test="data">{"name":"Pufu Lens"}</script>
              </head>`,
            ),
        },
      },
    ],
    logLevel: 'silent',
    build: { write: false },
  })) as Rollup.RollupOutput;
  assets = new Map(
    result.output
      .filter((output) => output.type === 'asset')
      .map((output) => [output.fileName, String(output.source)]),
  );
});

it('HTMLの表記にかかわらずmodule scriptを除去し、通常のスクリプトとデータは維持する', () => {
  for (const page of ['privacy', 'terms']) {
    const { document } = parseHTML(assets.get(`${page}/index.html`)!);
    for (const name of ['single-quoted', 'unquoted', 'uppercase']) {
      expect(document.querySelector(`script[data-test="${name}"]`)).toBeNull();
    }
    expect(document.querySelector('script[data-test="classic"]')?.textContent).toContain(
      "console.log('classic')",
    );
    expect(document.querySelector('script[data-test="data"]')?.textContent).toBe(
      '{"name":"Pufu Lens"}',
    );
  }
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

it.each([
  ['privacy', 'プライバシーポリシー', 'google-user-data'],
  ['terms', '利用規約', 'application'],
])('%s を本文・節リンク・スタイル付きの静的HTMLとしてビルドする', (page, title, section) => {
  const html = assets.get(`${page}/index.html`);
  expect(html).toBeDefined();
  const { document } = parseHTML(html!);
  expect(document.title).toBe(`${title} | Pufu Lens`);
  expect(document.querySelector('main h1')?.textContent).toBe(title);
  expect(document.querySelector(`#${section} h2`)).not.toBeNull();
  expect(document.querySelector('#retention, #termination')).not.toBeNull();
  expect(document.querySelectorAll('main section').length).toBeGreaterThanOrEqual(10);
  for (const href of ['/', '/privacy', '/terms', '#legal-start']) {
    expect(document.querySelector(`a[href="${href}"]`)).not.toBeNull();
  }
  const stylesheet = document.querySelector('link[rel="stylesheet"]')?.getAttribute('href');
  expect(assets.has(stylesheet!.slice(1))).toBe(true);
  expect(document.querySelector('script[src="/theme.js"]')).not.toBeNull();
  expect(document.querySelector('script[type="module"]')).toBeNull();
});

it('トップの初期HTMLにサービス説明と法的文書へのリンクを残し、アプリも起動できる', () => {
  const { document } = parseHTML(assets.get('index.html')!);
  expect(document.querySelector('#root h1')?.textContent).toContain('Pufu Lens');
  expect(document.querySelector('#root p')?.textContent?.length).toBeGreaterThan(20);
  for (const href of ['/privacy', '/terms']) {
    expect(document.querySelector(`#root a[href="${href}"]`)).not.toBeNull();
  }
  expect(document.querySelector('script[type="module"]')).not.toBeNull();
});
