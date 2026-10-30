import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { api } from '../src/api';

const { roots } = vi.hoisted(() => ({ roots: [] as Root[] }));
vi.mock('react-dom/client', async (original) => {
  const actual = await original<typeof import('react-dom/client')>();
  return {
    ...actual,
    createRoot(container: Parameters<typeof actual.createRoot>[0]) {
      const root = actual.createRoot(container);
      roots.push(root);
      return root;
    },
  };
});
vi.mock('../src/api', async (original) => ({
  ...(await original<typeof import('../src/api')>()),
  api: vi.fn(),
}));
let document: Document;
let primary: { language: string };
let saved: string | null;
beforeEach(() => {
  vi.resetModules();
  const dom = parseHTML('<html><head></head><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  primary = { language: 'en-US' };
  saved = null;
  vi.stubGlobal(
    'window',
    new Proxy(dom.window, {
      get(target, key) {
        return key === 'navigator' ? primary : Reflect.get(target, key);
      },
    }),
  );
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperties(window, {
    location: { configurable: true, value: { pathname: '/manual', search: '', hash: '' } },
    localStorage: { configurable: true, value: { getItem: () => saved, setItem() {} } },
    matchMedia: {
      configurable: true,
      value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    },
  });
  vi.mocked(api).mockResolvedValue({
    user: {
      id: 'account',
      name: 'User',
      bio: '',
      avatar_url: null,
      language: 'ja',
      onboarding_completed_at: '2026-10-30',
    },
  });
});
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it.each([
  ['en-US', null, 'User manual', '/en/privacy'],
  ['ja-JP', null, 'ユーザーマニュアル', '/privacy?lang=ja'],
  ['ja-JP', 'en', 'User manual', '/en/privacy'],
])(
  'the production manual entry follows primary %s and saved %s independently of the account',
  async (browser, preference, heading, privacy) => {
    primary.language = browser;
    saved = preference;
    await act(async () => {
      await import('../src/main');
    });
    expect(document.querySelector('h1')?.textContent).toBe(heading);
    expect(document.querySelector(`a[href="${privacy}"]`)).not.toBeNull();
    expect(api).not.toHaveBeenCalled();
  },
);
