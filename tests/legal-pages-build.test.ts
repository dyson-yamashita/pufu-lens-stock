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
  expect(document.documentElement.lang).toBe('ja');
  expect(document.title).toBe(`${title} | Pufu Lens`);
  expect(document.querySelector('main h1')?.textContent).toBe(title);
  expect(document.querySelector(`#${section} h2`)).not.toBeNull();
  expect(document.querySelector('#retention, #termination')).not.toBeNull();
  expect(document.querySelectorAll('main section').length).toBeGreaterThanOrEqual(10);
  for (const href of ['/', '/privacy', '/terms', '#legal-start']) {
    expect(document.querySelector(`a[href="${href}"]`)).not.toBeNull();
  }
  expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toContain(
    `/${page}`,
  );
  expect(document.querySelector('link[hreflang="x-default"]')).not.toBeNull();
  expect(document.querySelector('script[type="application/ld+json"]')).not.toBeNull();
  const stylesheet = document.querySelector('link[rel="stylesheet"]')?.getAttribute('href');
  expect(assets.has(stylesheet!.slice(1))).toBe(true);
  expect(document.querySelector('script[src="/theme.js"]')).not.toBeNull();
  expect(document.querySelector('script[type="module"]')).toBeNull();
});

it('トップと英語トップにクロール可能な本文・hreflang・JSON-LDを残し、アプリも起動できる', () => {
  for (const [file, lang, path] of [
    ['index.html', 'ja', '/'],
    ['en/index.html', 'en', '/en'],
  ] as const) {
    const html = assets.get(file)!;
    expect(html).toContain('<!--public-root-start-->');
    expect(html).toContain('<!--public-root-end-->');
    const { document } = parseHTML(html);
    expect(document.documentElement.lang).toBe(lang);
    expect(document.querySelector('#root h1')?.textContent?.length).toBeGreaterThan(5);
    expect(document.querySelector('#root p')?.textContent?.length).toBeGreaterThan(20);
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toContain(path);
    expect(document.querySelector('link[hreflang="en"]')).not.toBeNull();
    expect(
      [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map((node) => node.textContent)
        .join('\n'),
    ).toContain('SoftwareApplication');
    expect(document.querySelector('script[type="module"]')).not.toBeNull();
  }
});

it('マニュアルの日英静的HTMLに本文・HowTo/FAQ JSON-LDを含める', () => {
  for (const [file, lang, title] of [
    ['manual/index.html', 'ja', 'ユーザーマニュアル'],
    ['en/manual/index.html', 'en', 'User manual'],
  ] as const) {
    const { document } = parseHTML(assets.get(file)!);
    expect(document.documentElement.lang).toBe(lang);
    expect(document.querySelector('main h1')?.textContent).toBe(title);
    expect(document.querySelectorAll('main section').length).toBeGreaterThan(5);
    expect(
      [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map((node) => node.textContent)
        .join('\n'),
    ).toMatch(/HowTo|FAQPage/);
    expect(document.querySelector('script[type="module"]')).toBeNull();
  }
});

it.each([
  ['privacy', 'Privacy Policy', 'google-user-data'],
  ['terms', 'Terms of Service', 'application'],
])(
  'builds complete English %s without JavaScript and links to the governing original',
  (page, title, section) => {
    const html = assets.get(`en/${page}/index.html`);
    expect(html).toBeDefined();
    const { document } = parseHTML(html!);
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe(`${title} | Pufu Lens`);
    expect(document.querySelector('main h1')?.textContent).toBe(title);
    expect(document.querySelector(`#${section} h2`)).not.toBeNull();
    expect(document.querySelectorAll('main section').length).toBeGreaterThanOrEqual(10);
    expect(document.querySelector(`a[href="/${page}"]`)).not.toBeNull();
    for (const path of ['/en/privacy', '/en/terms'])
      expect(document.querySelector(`a[href="${path}"]`)).not.toBeNull();
    expect(document.querySelector('script[type="module"]')).toBeNull();
    expect(document.querySelector('script[src="/theme.js"]')).not.toBeNull();
    expect(document.querySelector('main')?.textContent).toContain('Japanese original');
  },
);

it('the Japanese legal originals keep language-stable section and footer links without JavaScript', () => {
  const { document } = parseHTML(assets.get('terms/index.html')!);
  for (const path of [
    '/privacy#publication',
    '/privacy#processors',
    '/privacy#retention',
    '/en/terms',
  ]) {
    expect(document.querySelector(`a[href="${path}"]`)).not.toBeNull();
  }
  expect(document.querySelector('script[type="module"]')).toBeNull();
});
