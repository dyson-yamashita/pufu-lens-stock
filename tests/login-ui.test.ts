import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import App from './app-root';
import { api, ApiError } from '../src/lib/api';
import { setLanguage } from '../src/i18n/i18n';

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
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
  const theme = { preference: 'system', theme: 'light' } as const;
  window.pufuTheme = { getSnapshot: () => theme, subscribe: () => () => {}, setPreference() {} };
  setLanguage('ja');
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/api/config') return { demo: true, googleConfigured: true, aiEnabled: false };
    if (path === '/api/v1/me') throw new ApiError('Unauthorized', 401);
    if (path.startsWith('/api/public/projects'))
      return {
        items: [
          {
            public_id: 'sample',
            name: '公開プロジェクト',
            stock_count: 23,
            question_count: 23,
            pufu_count: 4,
          },
        ],
        total: 1,
        has_more: false,
      };
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

it.each([
  ['/', 'ja', '気づきを残し、AIと育て、次の一歩へ。', 'Googleで始める', '使い方を見る'],
  [
    '/en',
    'en',
    'Save insights. Grow them with AI. Take your next step.',
    'Get started with Google',
    'See how it works',
  ],
] as const)(
  '%s は3つの独立した入口と初めの体験を示し、既存の導線を維持する',
  async (path, language, headline, cta, manual) => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hash: '', pathname: path, search: '' },
    });
    await render();
    const section = document.querySelector('#what-you-can-do')!;
    expect(document.querySelector('h1')?.textContent).toBe(headline);
    expect(section.querySelectorAll('.home-entry')).toHaveLength(3);
    expect(section.querySelector('ol')).toBeNull();
    expect(section.querySelectorAll('.home-entry-example')).toHaveLength(3);
    expect(section.querySelector('.home-entry-list')?.textContent).not.toContain('MCP');
    expect(section.querySelector('.home-integration')?.textContent).toContain('MCP');
    const prefix = language === 'ja' ? '' : '/en';
    expect(section.querySelector('.home-integration a')?.getAttribute('href')).toBe(
      `${prefix}/manual#integrations`,
    );
    expect(document.querySelector('.google-button')?.textContent).toContain(cta);
    expect(document.querySelector('.google-button')?.getAttribute('href')).toBe('/api/auth/google');
    expect(document.querySelector('.login-manual-link')?.textContent).toBe(manual);
    expect(document.querySelector('.login-manual-link')?.getAttribute('href')).toBe(
      `${prefix}/manual`,
    );
    expect(document.querySelectorAll('#use-cases article')).toHaveLength(3);
    expect(document.querySelector('.public-project-card')?.getAttribute('href')).toBe('/p/sample');
    expect(document.querySelector('.public-card-footer')?.textContent).toContain(
      language === 'ja' ? '4 プ譜' : '4 Pufu',
    );
    expect(document.querySelector('.demo-login')).not.toBeNull();
    // The public HTML and loaded app must describe the same service and starting points.
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { default: HomeShell } = await import('../src/features/auth/HomeShell');
    const shell = parseHTML(renderToStaticMarkup(createElement(HomeShell, { language }))).document;
    expect(shell.querySelector('h1')?.textContent).toBe(headline);
    expect(shell.querySelector('#what-you-can-do')?.textContent).toBe(section.textContent);
    expect(shell.querySelector('#use-cases')?.textContent).toBe(
      document.querySelector('#use-cases')?.textContent,
    );
  },
);

it.each([true, false])(
  'Google未設定では認証リンクを無効にし、マニュアルと公開一覧は使える（demo=%s）',
  async (demo) => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === '/api/config') return { demo, googleConfigured: false, aiEnabled: false };
      if (path === '/api/v1/me') throw new ApiError('Unauthorized', 401);
      if (path.startsWith('/api/public/projects')) return { items: [], total: 0, has_more: false };
      return {};
    });
    await render();
    expect(document.querySelector('.google-button')?.getAttribute('href')).toBeNull();
    expect(document.querySelector('.google-button')?.getAttribute('aria-disabled')).toBe('true');
    expect(!!document.querySelector('.demo-login')).toBe(demo);
    expect(document.querySelectorAll('#what-you-can-do .home-entry')).toHaveLength(3);
    expect(document.querySelector('.login-manual-link')?.getAttribute('href')).toBe('/manual');
    expect(document.querySelector('#public-projects')).not.toBeNull();
  },
);
