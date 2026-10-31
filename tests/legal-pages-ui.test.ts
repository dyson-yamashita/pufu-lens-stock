import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';

const { render } = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render }) }));
vi.mock('../src/App', () => ({ default: () => createElement('div', {}, '認証付きアプリ') }));
vi.mock('../src/PublicProjects', () => ({ default: () => null }));
vi.mock('../src/UserManual', () => ({ default: () => null }));

beforeEach(() => {
  vi.resetModules();
  render.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

it.each([
  ['/privacy', 'プライバシーポリシー'],
  ['/privacy/', 'プライバシーポリシー'],
  ['/terms', '利用規約'],
  ['/terms/', '利用規約'],
])('%s を認証付きアプリから独立して表示し、目次なしで本文を表示する', async (pathname, title) => {
  vi.stubGlobal('window', { location: { pathname, hash: '' } });
  vi.stubGlobal('document', parseHTML('<div id="root"></div>').document);
  await import('../src/main');
  const { document } = parseHTML(renderToStaticMarkup(render.mock.calls[0][0]));
  expect(document.querySelector('h1')?.textContent).toBe(title);
  expect(document.body.textContent).not.toContain('認証付きアプリ');
  expect(document.querySelector('nav[aria-label="目次"]')).toBeNull();
  expect(document.querySelectorAll('main .manual-section').length).toBeGreaterThan(0);
  for (const path of ['/', '/privacy?lang=ja', '/terms?lang=ja']) {
    expect(document.querySelector(`a[href="${path}"]`)).not.toBeNull();
  }
});

it.each([
  ['/privacy', '', 'en-US', 'Privacy Policy'],
  ['/terms/', '', 'fr-FR', 'Terms of Service'],
  ['/terms', '?lang=ja', 'en-US', '利用規約'],
  ['/privacy', '?lang=en', 'ja-JP', 'Privacy Policy'],
  ['/en/terms', '?lang=ja', 'ja-JP', 'Terms of Service'],
])(
  'the SPA entry resolves legal language for %s%s and primary %s',
  async (pathname, search, primary, title) => {
    vi.stubGlobal('window', {
      location: { pathname, search, hash: '' },
      navigator: { language: primary },
    });
    vi.stubGlobal(
      'document',
      parseHTML('<html><body><div id="root"></div></body></html>').document,
    );
    await import('../src/main');
    const { document } = parseHTML(renderToStaticMarkup(render.mock.calls[0][0]));
    expect(document.querySelector('h1')?.textContent).toBe(title);
    if (title === '利用規約')
      expect(document.querySelector('a[href="/terms?lang=ja"]')).not.toBeNull();
  },
);
