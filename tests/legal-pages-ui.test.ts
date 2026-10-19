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
])('%s を認証付きアプリから独立して表示し、目次から本文を参照できる', async (pathname, title) => {
  vi.stubGlobal('window', { location: { pathname, hash: '' } });
  vi.stubGlobal('document', parseHTML('<div id="root"></div>').document);
  await import('../src/main');
  const { document } = parseHTML(renderToStaticMarkup(render.mock.calls[0][0]));
  expect(document.querySelector('h1')?.textContent).toBe(title);
  expect(document.body.textContent).not.toContain('認証付きアプリ');
  const tocLinks = [...document.querySelectorAll('nav[aria-label="目次"] a')];
  expect(tocLinks.length).toBeGreaterThan(0);
  for (const link of tocLinks) {
    const section = document.querySelector(link.getAttribute('href')!);
    expect(section?.querySelector('h2')?.textContent).toBe(link.textContent);
  }
  for (const path of ['/', '/privacy', '/terms']) {
    expect(document.querySelector(`a[href="${path}"]`)).not.toBeNull();
  }
});
