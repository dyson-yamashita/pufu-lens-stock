import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import App from '../src/App';
import { api, ApiError } from '../src/api';
import { setLanguage } from '../src/i18n';

vi.mock('../src/api', async (original) => ({
  ...(await original<typeof import('../src/api')>()),
  api: vi.fn(),
  send: vi.fn(),
}));

let root: Root;
let document: Document;

beforeEach(() => {
  const dom = parseHTML('<html><head></head><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperties(window, {
    location: { configurable: true, value: { hash: '', pathname: '/', search: '' } },
    matchMedia: {
      configurable: true,
      value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    },
    scrollTo: { configurable: true, value() {} },
  });
  setLanguage('ja');
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/api/config') return { demo: true, googleConfigured: true, aiEnabled: false };
    if (path === '/api/v1/me') throw new ApiError('Unauthorized', 401);
    if (path.startsWith('/api/public/projects')) return { items: [], total: 0, has_more: false };
    return {};
  });
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const render = () => act(async () => root.render(createElement(App)));

it('ログイン画面に「できること」3ステップとMCP案内を出し、旧チップ文言は出さない', async () => {
  await render();
  const section = document.querySelector('#what-you-can-do');
  expect(section).not.toBeNull();
  expect(section?.getAttribute('aria-hidden')).toBeNull();
  expect(section?.querySelector('h2')?.textContent).toBe('Pufu Lensでできること');
  const titles = [...section!.querySelectorAll('h3')].map((node) => node.textContent);
  expect(titles).toEqual(['記事をストックする', '問い・気づきとメモリに育てる', 'プ譜で考える']);
  expect(section?.textContent).toContain(
    '気になった記事を、URLかテキストでプロジェクトに保存します。',
  );
  expect(section?.textContent).toContain(
    '要約から問い・気づきが生まれ、関心と知識がメモリにつながります。',
  );
  expect(section?.textContent).toContain(
    '目指すゴールと打ち手を1枚にまとめる思考の地図「プ譜」で、次の一手を整理します。',
  );
  expect(section?.textContent).toContain(
    'ChatGPTなどのAIから、ストックや問い・気づきを使うこともできます（MCP連携）。',
  );
  expect(section?.querySelector('a[href="/manual#integrations"]')?.textContent).toBe(
    '連携のしかた',
  );
  expect(section?.querySelector('a[href="#public-projects"]')?.textContent).toBe(
    '公開プロジェクトで実例を見る',
  );
  expect(document.querySelector('#public-projects')).not.toBeNull();
  expect(document.querySelector('.login-features')).toBeNull();
  expect(document.body.textContent).not.toContain('プロジェクトで整理');
  expect(document.body.textContent).not.toContain('記事からメモリへ');
  expect(document.body.textContent).not.toContain('MCPでAIと連携');
  expect(document.querySelector('.demo-login')).not.toBeNull();
  expect(document.querySelector('#what-you-can-do h3')).not.toBeNull();
});

it('英語ランディングでも3ステップ文言とマニュアルリンクを出す', async () => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { hash: '', pathname: '/en', search: '' },
  });
  await render();
  const section = document.querySelector('#what-you-can-do');
  expect(section?.querySelector('h2')?.textContent).toBe('What you can do with Pufu Lens');
  expect([...section!.querySelectorAll('h3')].map((node) => node.textContent)).toEqual([
    'Stock articles',
    'Grow questions, insights and memory',
    'Think it through with Pufu',
  ]);
  expect(section?.querySelector('a[href="/en/manual#integrations"]')?.textContent).toBe(
    'How to connect',
  );
  expect(section?.querySelector('a[href="#public-projects"]')?.textContent).toBe(
    'See examples in public projects',
  );
});

it('デモ無効でも3ステップセクションは同じ構成で出す', async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/api/config') return { demo: false, googleConfigured: true, aiEnabled: false };
    if (path === '/api/v1/me') throw new ApiError('Unauthorized', 401);
    if (path.startsWith('/api/public/projects')) return { items: [], total: 0, has_more: false };
    return {};
  });
  await render();
  expect(document.querySelector('.demo-login')).toBeNull();
  expect(document.querySelectorAll('#what-you-can-do h3')).toHaveLength(3);
  expect(document.querySelector('#what-you-can-do a[href="#public-projects"]')).not.toBeNull();
});
